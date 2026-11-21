// node --test tests/  · simulador de licitaciones: pruebas del módulo original + integración (escenarios, huella, Excel)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { simularOferta, evaluarOferta, escenarios, huella, excelOferta, entradaDesde, estadoOferta } from "../netlify/functions/licalc.mjs";

const entrada = { presupuestoBruto: 95_000_000, descuentoBps: 500, logisticaNeta: 12_000_000, lineas: [{ id: "cemento", cantidad: 11_000, compraUnitariaBruta: 5690, peso: 1 }] };
const precio = simularOferta(entrada);
const oferta = { lectura: "validada", version: "v2", versionAprobada: "v2", manifiestoValidado: true, costosConfirmados: true, precio, representanteAcreditado: true,
  documentos: [{ nombre: "Anexo 1", obligatorio: true, archivoVerificado: true, requiereFirma: true, firmaVerificada: true, versionFirmada: "v2" }] };

test("el escenario 5% reproduce los valores del Excel", () => {
  assert.deepEqual([precio.detalle[0].precioUnitarioNeto, precio.ventaBruta, precio.utilidad, precio.resultadoTrasPpm], [6894, 90242460, 8962341, 6687321]);
});
test("el descuento reduce utilidad y el tope obligatorio se valida", () => {
  assert.ok(simularOferta({ ...entrada, descuentoBps: 1000 }).utilidad < precio.utilidad);
  assert.equal(simularOferta({ ...entrada, topeBrutoObligatorio: 90_000_000 }).superaTope, true);
});
test("error de lectura y documentos faltantes bloquean la entrega", () => {
  assert.equal(evaluarOferta({ ...oferta, lectura: "error" }).listoParaOfertar, false);
  assert.equal(evaluarOferta({ ...oferta, documentos: [] }).listoParaOfertar, false);
});
test("solo la firma verificada de la versión aprobada habilita el ZIP", () => {
  const anterior = { ...oferta.documentos[0], versionFirmada: "v1" };
  assert.equal(evaluarOferta({ ...oferta, documentos: [anterior] }).listoParaFirmar, true);
  assert.equal(evaluarOferta({ ...oferta, documentos: [anterior] }).listoParaOfertar, false);
  assert.equal(evaluarOferta(oferta).listoParaOfertar, true);
});
test("tres escenarios: completo, elegido y máximo descuento con margen sobre el piso; sin precio viable cuando no cabe", () => {
  const e = escenarios(entrada, 0.08); const [c, el, p] = e.escenarios;
  assert.equal(c.descuentoBps, 0); assert.equal(el.descuentoBps, 500); assert.ok(p.descuentoBps > 500 && p.viable && p.precio.margen >= 0.08);
  assert.ok(e.hayViable);
  const caro = escenarios({ ...entrada, lineas: [{ ...entrada.lineas[0], compraUnitariaBruta: 9000 }] }, 0.12);
  assert.equal(caro.hayViable, false); assert.equal(caro.escenarios[2].precio, null); assert.match(caro.escenarios[0].motivo, /pierde plata|bajo el piso/);
});
test("la huella cambia con cualquier supuesto", () => {
  const h = huella(entrada, precio); assert.equal(h.length, 16);
  assert.notEqual(h, huella({ ...entrada, logisticaNeta: 12_000_001 }, simularOferta({ ...entrada, logisticaNeta: 12_000_001 })));
  assert.equal(h, huella(JSON.parse(JSON.stringify(entrada)), simularOferta(entrada)));
});
test("entradaDesde arma la entrada con los productos elegidos y marca lo que falta", () => {
  const t = { auto: { lic: { presupuesto: 95_000_000, presupuesto_con_iva: true, items: [{ id: "I1", nombre: "Cemento 25 kg", cantidad: 11000 }] }, precios: { descuento: 0.05 }, decision: { numeros: { flete: 12_000_000, otros: 0 } },
    seleccion: [{ itemId: "I1", cantidad: 11000, cotizacion: { unitNeto: 4782, evidencia: { estado: "verificado" }, stock: "verificado" } }] } };
  const e = entradaDesde(t); assert.equal(e.presupuestoBruto, 95_000_000); assert.equal(e.descuentoBps, 500); assert.equal(e.logisticaNeta, 12_000_000);
  assert.equal(e.lineas[0].compraUnitariaBruta, 5691); assert.deepEqual(e.faltan, []);
  const sin = entradaDesde({ auto: { lic: {}, seleccion: [] } }); assert.ok(sin.faltan.includes("presupuesto") && sin.faltan.includes("productos con precio real"));
  const est = estadoOferta({ auto: { ...t.auto, lic: { ...t.auto.lic, bases_leidas: true, documentos: [{ nombre: "Anexo 1", obligatorio: true, firma: true }] }, version_actual: { hash: "a" }, version_aprobada: { hash: "a", precio }, firmas: { "Anexo 1": { version: "a" } }, docs: { archivos: [{ nombre: "x.pdf" }] } } }, { facultades_ok: true });
  assert.equal(evaluarOferta(est).listoParaOfertar, true);
  const ev = evaluarOferta({ ...est, firmas: null, documentos: est.documentos.map((d) => ({ ...d, versionFirmada: "viejo" })) }); assert.equal(ev.listoParaOfertar, false); assert.deepEqual(ev.firmasPendientes, ["Anexo 1"]);
});
test("el Excel recalcula en LibreOffice los mismos valores que el simulador", { skip: !fs.existsSync("/usr/bin/soffice") && !fs.existsSync("/usr/local/bin/soffice") }, () => {
  const buf = excelOferta({ ...entrada, ivaBps: 1900, factoringBps: 300, ppmBps: 300, costoGarantiaNeto: 0, topeBrutoObligatorio: null, lineas: [{ ...entrada.lineas[0], nombre: "Cemento 25 kg" }] }, precio, { id: "1004-68-LP26", version: "v1" });
  const dir = fs.mkdtempSync("/tmp/licalc-"); fs.writeFileSync(dir + "/s.xlsx", buf);
  execSync(`cd ${dir} && soffice --headless --convert-to csv s.xlsx >/dev/null 2>&1`); const csv = fs.readFileSync(dir + "/s.csv", "utf8");
  assert.match(csv, /6894/); assert.match(csv, /90242460/); assert.match(csv, /8962341/);
});
test("la copia del navegador (public/licalc.js) calcula igual que el servidor", () => {
  const src = fs.readFileSync(new URL("../public/licalc.js", import.meta.url), "utf8"); const w = {}; new Function("window", src)(w);
  const p = w.LICALC.simularOferta(entrada); assert.deepEqual([p.detalle[0].precioUnitarioNeto, p.ventaBruta, p.utilidad], [6894, 90242460, 8962341]);
  assert.deepEqual(w.LICALC.escenarios(entrada, 0.08).escenarios.map((e) => e.descuentoBps), escenarios(entrada, 0.08).escenarios.map((e) => e.descuentoBps));
});

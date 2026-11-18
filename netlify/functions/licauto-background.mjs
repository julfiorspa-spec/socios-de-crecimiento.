// 🏛 Licitador automático en segundo plano (Netlify Background Function: hasta 15 minutos).
// La ruta /bot/lic-auto la invoca con el token del robot; aquí corren los pasos lentos (Claude lee las bases, búsqueda, documentos).
import { licCtx, _licDeps } from "./robot.mjs";
export default async (req) => {
  if (req.method !== "POST" || !_licDeps.autorizado(req)) return new Response("no", { status: 401 });
  const b = await req.json().catch(() => ({})); const codigo = String(b.codigo || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
  const store = _licDeps.getStore({ name: _licDeps.STORE, consistency: "strong" });
  const t = await _licDeps.leer(store, codigo); if (!t) return new Response("sin trabajo", { status: 404 });
  const ctx = licCtx(store, t.empresa);
  try { await _licDeps.licCorrer(ctx, t, { presupuestoMs: 14 * 60e3 }); } catch (e) { t.auto = t.auto || {}; t.auto.error = "fondo: " + String(e.message || e).slice(0, 200); t.auto.corriendo = null; await ctx.escribir(t); }
  return new Response("ok");
};

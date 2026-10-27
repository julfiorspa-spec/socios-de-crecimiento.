# Socios de Crecimiento

App para empresas que quieren crecer vendiendo al Estado en Mercado Público.

- **Inicio**: oportunidades reales de hoy, para decidir rápido (descartar o ir al negocio).
- **Oportunidades**: licitaciones abiertas que calzan con tus rubros, ordenadas por cierre.
- **Mercado**: estudio de 12 meses por rubro: cuánto se compra, sub-rubros, precios de referencia, compradores, regiones y competidores.
- **Crecer**: lo que piden junto a tu rubro (datos reales), gamas de producto, servicios complementarios y giros para abrir.
- **Cotizar**: cotizador prellenado desde la licitación, con neto, IVA, total y texto listo para pegar. Registra resultados para aprender tu tasa de adjudicación.

La app **no inicia sesión ni envía ofertas**: el envío final siempre se hace en mercadopublico.cl.

## Cómo publicarla en Netlify

La forma más simple es con Git (GitHub) para que Netlify instale la función automáticamente:

1. Crea un repositorio **privado** en GitHub y sube el contenido de esta carpeta.
2. En Netlify: **Add new site → Import an existing project → GitHub** y elige el repositorio. No hace falta configurar comando de compilación; el archivo `netlify.toml` ya indica todo.
3. En Netlify: **Site configuration → Environment variables → Add a variable**
   - Nombre: `MP_TICKET`
   - Valor: tu ticket de la API de Mercado Público (el código que llegó por correo).
4. Vuelve a desplegar (**Deploys → Trigger deploy**). Abre `https://TU-SITIO.netlify.app/api/estado`: debe decir `{"ok":true}`.

> Arrastrar la carpeta a Netlify Drop publica la página pero **no** la función, así que las oportunidades no cargarían. Usa GitHub o la CLI de Netlify (`netlify deploy --prod`).

**Nunca pongas el ticket dentro de `index.html` ni lo subas al repositorio.** Solo va en la variable de entorno.

## Estructura

```
public/                 lo que ve el usuario
  index.html            la app completa
  data/rubros.json      catálogo de rubros y lógica de crecimiento (editable)
  data/estudio.json     estudio de mercado de 12 meses (generado)
netlify/functions/mp.mjs  puente seguro con la API de Mercado Público (usa MP_TICKET)
netlify.toml            configuración de Netlify (rutas, función)
tools/analizar.js       script que genera estudio.json a partir de la muestra
```

## Agregar un rubro nuevo

Edita `public/data/rubros.json`: copia un rubro existente, cambia el nombre, las palabras clave (`kw`) y las ideas de expansión. Para que tenga cifras en **Mercado** hay que regenerar el estudio con ese rubro incluido.

## Límites conocidos

- Las **Compras Ágiles abiertas** no están en la API pública; se revisan en el portal. Las compras ágiles ya adjudicadas sí entran al estudio.
- El estudio es una **muestra** (un día por semana durante 12 meses) proyectada al año; las cifras son estimaciones conservadoras.
- La detección por palabras clave puede traer algún falso positivo; el estudio corrige con la categoría oficial de cada producto.

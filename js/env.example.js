/**
 * @file js/env.example.js
 * @description Plantilla de configuración de entorno para NeuroLab SST.
 *
 * INSTRUCCIONES:
 *   1. Copie este archivo a `js/env.js` (ese archivo NO se versiona — está
 *      listado en `.gitignore`; contiene la clave anónima del proyecto
 *      Supabase, que aunque no es secreta en el sentido estricto de OWASP,
 *      no debe versionarse junto al código para permitir rotación y
 *      configuración distinta por entorno sin tocar el repositorio).
 *   2. Complete los valores con los del proyecto Supabase ÚNICO definido en
 *      Fase 3 (`gxruywleggikajvtszhn` y `eouolukabjsunjpoqhaw` quedan
 *      obsoletos — Fase 3 §1 exige consolidar en un solo proyecto).
 *   3. `index.html` carga `js/env.js` ANTES de `js/app.js` (ver comentario
 *      en index.html) para garantizar que `window.__NEUROLAB_ENV__` exista
 *      cuando `js/config.js` lo lea.
 *
 * En despliegue (hosting estático), este archivo se genera en tiempo de
 * build/deploy a partir de variables de entorno del proveedor (Netlify,
 * Vercel, GitHub Pages con Actions, etc.) — nunca se edita a mano en
 * producción.
 */

window.__NEUROLAB_ENV__ = {
  // URL del proyecto Supabase único (Fase 3 §1). Ejemplo: 'https://TU-PROYECTO.supabase.co'
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',

  // Clave anónima (pública) del proyecto Supabase. Protegida en el backend por RLS (Fase 3 §13), no por secreto.
  SUPABASE_ANON_KEY: 'TU-CLAVE-ANONIMA',

  // 'development' | 'staging' | 'production'
  APP_ENV: 'development',

  // 'debug' | 'info' | 'warn' | 'error'
  LOG_LEVEL: 'debug',
};

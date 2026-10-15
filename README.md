# NeuroLab SST v8.0

Plataforma de vigilancia cognitiva operacional (prevención de fatiga y somnolencia) para
operadores de planta y maquinaria — CIRSSAT · Grupo Termotasajero.

Aplicación web **estática** (HTML + CSS + JavaScript ES modules, sin paso de compilación) que
usa **Supabase** (PostgreSQL + Auth + RLS) como backend. Funciona como PWA, sin conexión.

Especificación: Fase 1 (auditoría), Fase 2 (arquitectura) y Fase 3 (esquema Supabase).

---

## 1. Puesta en marcha (≈ 15 minutos)

Necesita: [Node.js 18+](https://nodejs.org) y un proyecto gratuito en [supabase.com](https://supabase.com).

1. **Crear el proyecto** en Supabase. En *Project Settings → API* copie la **URL** y la clave **anon / publishable**
   (nunca la `service_role`: el instalador la rechaza). En *Project Settings → Database → Connection string (URI)*
   copie la cadena de conexión y reemplace `[YOUR-PASSWORD]` por la contraseña de la base.
2. **Crear su usuario**: *Authentication → Users → Add user* (correo + contraseña, marque *Auto Confirm*).
3. **Instalar** (aplica las 18 migraciones, genera la configuración y crea su empresa y administrador):

   ```bash
   node scripts/instalar.mjs \
     --url https://SU-PROYECTO.supabase.co --anon-key SU_CLAVE_ANON \
     --db-url "postgresql://postgres:CONTRASEÑA@db.SU-PROYECTO.supabase.co:5432/postgres" \
     --empresa "Mi Empresa S.A." --nit 900123456-7 --admin-email usted@correo.com \
     --sembrar-provisional
   ```

   Sin argumentos (`node scripts/instalar.mjs`) pregunta cada dato. Requiere `psql` para la parte de base de datos;
   si no lo tiene, use `--solo-archivos`, pegue `supabase/instalacion.sql` en *SQL Editor → Run* y luego
   `supabase/bootstrap.sql` (reemplazando `__EMPRESA__`, `__NIT__`, `__ADMIN_EMAIL__`, `__SEMBRAR_PROVISIONAL__`).
   Es idempotente: puede repetirse sin duplicar nada.
4. **Abrir**: `node scripts/servir.mjs` y entre a <http://localhost:8000> con su correo y contraseña.

`--sembrar-provisional` crea pesos del ICO iguales y un baremo **institucional PROVISIONAL**
(excelente ≥ 80, atención ≥ 55) para que el ICO se calcule desde el primer día. **No son parámetros
científicos**: defínalos en *Configuración* antes de usar los resultados para decisiones laborales.

### Publicar en internet (HTTPS obligatorio)

Suba la carpeta tal cual a un hosting estático (Netlify, Cloudflare Pages, Vercel, GitHub Pages…).
`_headers` aporta las cabeceras de seguridad en Netlify/Cloudflare. **No suba** `supabase/bootstrap.generado.sql`
(está en `.gitignore`). En Supabase → *Authentication → URL Configuration* agregue la URL pública del sitio.

---

## 2. Qué incluye

| Módulo | Contenido |
|---|---|
| 1 Core | Router con guardas, i18n, tokens CSS, bus de eventos, logger, PWA |
| 2 Auth | Sesión Supabase, RBAC por permisos, selector de empresa |
| 3 Organization | Catálogos (áreas, procesos, centros, cargos, líneas), operadores, marca por empresa |
| 4 Scientific | Estadística, normalización, ICO ponderado, baremos (dinámico / institucional / científico) versionados |
| 5 Testing | 4 pruebas (atención, Stroop, memoria de secuencias, reacción), registro atómico e idempotente |
| 6 Indicators | 13 indicadores precalculados (`indicadores_valores`) por operador, área, cargo y empresa |
| 7 Rules | Reglas declarativas (sin código libre), alertas, recomendaciones, auditoría append-only, configuración de empresa |
| 8 Dashboards | Operativo, clínico, ejecutivo y científico (gráficas SVG accesibles; leen solo indicadores) |
| 9 Offline | Cola IndexedDB idempotente, reintento con retroceso, caché de configuración, aviso a supervisor |
| 10 Research | Cohortes, consentimientos separados (SST ≠ investigación), exportación CSV anónima y auditada |
| 11 Optimización | supabase-js propio (sin CDN), CSP estricta, instalador, auditoría de accesibilidad |

Roles de plantilla: Super Administrador, Administrador de empresa, Supervisor SST, Profesional PGR, Operador.
La **investigación** (`investigacion.acceder`, `datos.exportar`) la tiene el Super Administrador; asigne esos permisos
a un rol propio si desea un investigador dedicado.

---

## 3. Pruebas

```bash
node --test spec/*.test.mjs          # unitarias (≈150): estadística, indicadores, reglas, offline, CSV, instalador…
bash supabase/tests/run-local.sh     # migraciones 0001–0018 (x2, idempotencia) + 9 baterías SQL (RLS, auditoría, investigación, bootstrap…) en Postgres local
# Navegador (Chromium + Supabase simulado; requiere `playwright`):
for t in organization testing admin dashboard research a11y; do node spec/e2e/$t.e2e.mjs; done
```

`a11y.e2e.mjs` además requiere `axe-core` (`npm i axe-core`). Las pruebas de navegador validan la interfaz con una
base simulada (`spec/e2e/fake-supabase.mjs`); las **políticas RLS** las valida la batería SQL.

---

## 4. Arquitectura en una página

```
index.html ─ js/app.js ─ *-module.js (registra rutas + guardas)
   vistas (js/, admin/, dashboard/, research/)  →  services/ (reglas de negocio, sin DOM)
   →  js/repositories/ (único acceso a Supabase)  →  Supabase (RLS, funciones SECURITY DEFINER)
statistics/   matemática pura (probable en Node)        tests/   las 4 pruebas cognitivas
supabase/migrations/  0001–0018 (idempotentes)           vendor/  supabase-js empaquetado
```

Principios: configuración sobre código; multiempresa con `empresa_id` + FKs compuestas; ningún dato llega a `innerHTML`
(helper `h()`); errores de BD nunca se muestran crudos (`mensajeSeguro`); las fórmulas y umbrales viven en BD/archivos de
datos versionados, no dispersos.

### Seguridad
CSP estricta (`script-src 'self'`, `connect-src` limitado a su proyecto — la regenera el instalador), RLS en todas las
tablas, exportes solo vía RPC con permiso + mínimo 5 participantes + seudónimos por exportación + auditoría en la misma
transacción, CSV con protección contra inyección de fórmulas, consentimiento de investigación revocable (revocar saca a
la persona de las cohortes), auditoría inmutable sin datos personales.

### Mantenimiento
- Al cambiar cualquier archivo precacheado, suba `CACHE_VERSION` en `service-worker.js`.
- Actualizar supabase-js: ver `vendor/LEEME.md`.
- Nuevas migraciones: `supabase/migrations/NNNN_*.sql`, idempotentes; vuelva a correr `scripts/instalar.mjs`.

---

## 5. Limitaciones conocidas (léalas antes de usar en producción)

1. **Parámetros provisionales.** Fórmulas de indicadores, umbrales de reglas, pesos del ICO y baremos NO están
   validados científicamente. Los resultados orientan, no diagnostican; no usarlos solos para decisiones laborales.
2. **Cálculos en el cliente.** El puntaje, los indicadores y las reglas se calculan en el navegador del evaluador y se
   publican por RPC: un usuario con permiso de registrar evaluaciones podría falsear valores de su empresa. Mitigación
   futura: mover el cálculo a funciones de base de datos / Edge Functions.
3. **Sin pruebas contra un Supabase real.** Migraciones y RLS se probaron en PostgreSQL 16 local con stubs de Supabase;
   la interfaz, con una base simulada. Haga una prueba de humo en su proyecto antes de operar.
4. **Contraste y accesibilidad.** Auditoría automática (axe, WCAG 2.1 A/AA) sin hallazgos en 14 pantallas; el contraste
   se garantiza también para colores de marca por empresa. Falta revisión manual con lector de pantalla y las pantallas
   en ejecución de cada prueba cognitiva.
5. **Datos personales (Ley 1581).** Hay anonimización de operadores y consentimientos separados, pero la política de
   tratamiento, el aviso de privacidad y las autorizaciones firmadas son responsabilidad de la organización.
6. **Offline.** Una evaluación hecha sin red queda en el dispositivo hasta sincronizar; si se limpia el almacenamiento del
   navegador antes, se pierde. La caché de lectura guarda en el dispositivo el operador evaluado y se borra al cerrar sesión.
7. **Un solo idioma** (español, `locales/es.json`).

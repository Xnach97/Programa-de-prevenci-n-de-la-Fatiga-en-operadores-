# vendor/

`supabase-js.mjs` — `@supabase/supabase-js` **2.118.0** empaquetado como un único módulo ES
(minificado, sin dependencias en tiempo de ejecución). Licencia MIT: `LICENSE-supabase-js.txt`.

Se incluye en el repositorio para que la aplicación no dependa de un CDN (funciona sin
conexión, CSP estricta, sin riesgo de cambios de terceros en producción).

## Regenerar / actualizar

```bash
mkdir /tmp/vend && cd /tmp/vend && npm init -y && npm i @supabase/supabase-js@2 esbuild
echo "export { createClient } from '@supabase/supabase-js';" > entrada.mjs
npx esbuild entrada.mjs --bundle --format=esm --minify --platform=browser --target=es2022 \
  --legal-comments=inline --outfile=<ruta-al-repo>/vendor/supabase-js.mjs
```

Tras actualizar: ejecutar toda la batería (`README.md`) y subir la versión de caché en `service-worker.js`.

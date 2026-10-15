# NeuroLab SST v8.0

Plataforma Inteligente de Vigilancia Cognitiva Operacional — Termotasajero SST.

Especificación oficial: Fase 1 (auditoría técnica), Fase 2 (arquitectura aprobada),
Fase 3 (esquema Supabase). Este repositorio es la implementación módulo por módulo
sobre esa especificación ya aprobada.

## Arrancar en local

```bash
cp js/env.example.js js/env.js   # completar credenciales del proyecto Supabase único (Fase 3 §1)
python3 -m http.server 8000      # o cualquier servidor estático
```

Abrir `http://localhost:8000`.

## Estado de módulos

- [x] Módulo 1 — Core Platform
- [x] Módulo 2 — Authentication
- [x] Módulo 3 — Organization (catálogos, operadores, menú, marca de empresa)
- [x] Módulo 4 — Scientific Engine (estadística, score, ICO, baremos, versionado)
- [ ] Módulo 5 — Testing Engine
- [ ] Módulo 6 — Indicators Engine
- [ ] Módulo 7 — Rules Engine
- [ ] Módulo 8 — Dashboard Framework
- [ ] Módulo 9 — Offline Engine
- [ ] Módulo 10 — Research Platform
- [ ] Módulo 11 — Optimización final

## Pruebas

```bash
node --test spec/*.test.mjs        # unitarias: auth, marca, servicios de Organization, menú (sin red ni DOM)
bash supabase/tests/run-local.sh   # migraciones 0001–0008 (x2, idempotencia) + RLS, Organization y Scientific con aserciones, en Postgres local
node spec/e2e/organization.e2e.mjs # navegador real (Chromium) con Supabase simulado; requiere `playwright`
```

La prueba de navegador usa un Supabase en memoria (`spec/e2e/fake-supabase.mjs`):
valida la interfaz, no las políticas RLS (esas las cubre la batería SQL).

## Configuración local

`js/env.js` **no se versiona** (ver `.gitignore`). Cópielo desde `js/env.example.js`
y complete `SUPABASE_URL` y `SUPABASE_ANON_KEY`.

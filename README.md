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
- [x] Módulo 5 — Testing Engine (4 pruebas, registro atómico e idempotente de evaluaciones)
- [x] Módulo 6 — Indicators Engine (indicadores_valores, fórmulas provisionales, recálculo tras cada evaluación)
- [x] Módulo 7 — Rules Engine, Alertas, Auditoría y Configuración de empresa
- [x] Módulo 8 — Dashboard Framework (4 dashboards SVG, lectura solo de indicadores_valores)
- [ ] Módulo 9 — Offline Engine
- [ ] Módulo 10 — Research Platform
- [ ] Módulo 11 — Optimización final

## Pruebas

```bash
node --test spec/*.test.mjs        # unitarias: auth, marca, servicios de Organization, menú (sin red ni DOM)
bash supabase/tests/run-local.sh   # migraciones 0001–0016 (x2, idempotencia) + RLS, Organization, Scientific, Testing, Indicators, Rules y Audit con aserciones, en Postgres local
node spec/e2e/organization.e2e.mjs # navegador
node spec/e2e/testing.e2e.mjs      # evaluación completa (4 pruebas) en navegador
node spec/e2e/admin.e2e.mjs        # configuración, reglas, alertas y auditoría real (Chromium) con Supabase simulado; requiere `playwright`
node spec/e2e/dashboard.e2e.mjs    # dashboards operativo/clínico/ejecutivo/científico (Chromium) con Supabase simulado
```

La prueba de navegador usa un Supabase en memoria (`spec/e2e/fake-supabase.mjs`):
valida la interfaz, no las políticas RLS (esas las cubre la batería SQL).

## Configuración local

`js/env.js` **no se versiona** (ver `.gitignore`). Cópielo desde `js/env.example.js`
y complete `SUPABASE_URL` y `SUPABASE_ANON_KEY`.

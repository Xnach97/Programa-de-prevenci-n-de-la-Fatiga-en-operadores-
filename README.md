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
- [ ] Módulo 2 — Authentication
- [ ] Módulo 3 — Organization
- [ ] Módulo 4 — Scientific Engine
- [ ] Módulo 5 — Testing Engine
- [ ] Módulo 6 — Indicators Engine
- [ ] Módulo 7 — Rules Engine
- [ ] Módulo 8 — Dashboard Framework
- [ ] Módulo 9 — Offline Engine
- [ ] Módulo 10 — Research Platform
- [ ] Módulo 11 — Optimización final

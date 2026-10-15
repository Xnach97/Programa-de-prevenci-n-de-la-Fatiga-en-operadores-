-- =============================================================================
-- Migración: 0006_organization_seed.sql
-- Módulo 3 — Organization | Ajuste de permisos de plantilla
-- =============================================================================
-- Los roles Operador y Profesional PGR necesitan LEER los catálogos para
-- mostrar el área/cargo de un operador y para agrupar/filtrar resultados por
-- área en los dashboards. Se les concede `catalogos.ver` (solo lectura) en vez
-- de abrir una excepción en la política RLS, manteniendo el patrón único
-- `tiene_permiso(...)` de Fase 3 §13.
--
-- Idempotente. Solo afecta a las filas plantilla (empresa_id null); las
-- empresas que ya clonaron y personalizaron sus roles no se tocan.
-- =============================================================================

insert into roles_permisos (role_id, permiso_id)
select r.id, p.id
from roles r
cross join permisos p
where r.es_plantilla
  and r.empresa_id is null
  and r.nombre in ('Operador', 'Profesional PGR')
  and p.codigo = 'catalogos.ver'
on conflict (role_id, permiso_id) do nothing;

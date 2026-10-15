/**
 * @file spec/e2e/fake-supabase.mjs
 * @description Módulo ES que sustituye a `@supabase/supabase-js` en la prueba
 * de navegador: base de datos en memoria con el subconjunto de la API que usa
 * la app (auth, from().select/insert/update/eq/or/order/range/maybeSingle/single).
 * Replica las reglas de BD relevantes (unicidad, anonimización) para ejercitar
 * la UI de punta a punta SIN red. No sustituye a la batería SQL (RLS real).
 *
 * Se inyecta como texto vía `page.route` (ver organization.e2e.mjs).
 */
export const FAKE_SUPABASE_SOURCE = `
const EMPRESA_A = 'c1000000-0000-4000-8000-00000000000a';
const EMPRESA_B = 'c1000000-0000-4000-8000-00000000000b';
const USUARIO = 'a1000000-0000-4000-8000-000000000001';
const PERMISOS = window.__E2E_PERMISOS__ || ['catalogos.ver','catalogos.editar','operadores.ver','operadores.administrar'];
const db = {
  usuarios: [{ id: USUARIO, empresa_id: EMPRESA_A, nombre_completo: 'Ana Admin', email: 'a@x.co', estado: 'activo' }],
  configuracion_empresa: [
    { empresa_id: EMPRESA_A, marca: { color_primario: '#ff0000', logo_url: 'https://cdn.example.co/a.png' } },
    { empresa_id: EMPRESA_B, marca: { color_primario: 'red;background:url(x)', logo_url: "https://x.co/a')" } },
  ],
  pruebas: [], ico_configuraciones: [], baremos: [], evaluaciones: [], resultados_pruebas: [],
  areas: [], procesos: [], centros_trabajo: [], cargos: [], lineas_operacionales: [], operadores: [],
};
const uuid = () => crypto.randomUUID();
const lc = (s) => String(s).trim().toLowerCase();
window.__fakeDb = db;
if (window.__E2E_SEED__) window.__E2E_SEED__(db);

class Query {
  constructor(tabla) { this.tabla = tabla; this.op = 'select'; this.filtros = []; this.orFiltro = null; this.rango = null; this.payload = null; this.devuelve = false; this.unico = null; this.contar = false; }
  select(_c, opts) { this.devuelve = true; this.contar = !!(opts && opts.count); return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  eq(c, v) { this.filtros.push([c, v]); return this; }
  or(expr) { this.orFiltro = expr; return this; }
  order() { return this; }
  gte(c, v) { this.filtros.push([c, v, 'gte']); return this; }
  lte(c, v) { this.filtros.push([c, v, 'lte']); return this; }
  not(c, op, v) { this.filtros.push([c, v, 'not']); return this; }
  limit() { return this; }
  range(a, b) { this.rango = [a, b]; return this; }
  single() { this.unico = 'single'; return this; }
  maybeSingle() { this.unico = 'maybe'; return this; }
  then(ok, ko) { return Promise.resolve().then(() => this.ejecutar()).then(ok, ko); }

  filas() {
    let filas = db[this.tabla] || [];
    for (const [c, v, modo] of this.filtros) {
      if (modo === 'gte') filas = filas.filter((f) => f[c] >= v);
      else if (modo === 'lte') filas = filas.filter((f) => f[c] <= v);
      else if (modo === 'not') filas = filas.filter((f) => f[c] !== null && f[c] !== undefined);
      else filas = filas.filter((f) => f[c] === v);
    }
    if (this.orFiltro && this.orFiltro.includes('empresa_id.eq.')) {
      const id = this.orFiltro.match(/empresa_id\.eq\.([0-9a-f-]+)/)[1];
      filas = filas.filter((f) => f.empresa_id === id || f.empresa_id === null);
    } else if (this.orFiltro) {
      const terminos = [...this.orFiltro.matchAll(/ilike\\.%(.*?)%/g)].map((m) => lc(m[1]));
      const t = terminos[0] || '';
      filas = filas.filter((f) => ['cedula','nombre','apellido'].some((k) => f[k] && lc(f[k]).includes(t)));
    }
    return filas;
  }
  conEmbeds(f) {
    if (this.tabla !== 'operadores') return f;
    const nombre = (tabla, id) => { const x = db[tabla].find((r) => r.id === id); return x ? { nombre: x.nombre } : null; };
    return { ...f, cargo: nombre('cargos', f.cargo_id), area: nombre('areas', f.area_id), centro_trabajo: nombre('centros_trabajo', f.centro_trabajo_id), linea_operacional: nombre('lineas_operacionales', f.linea_operacional_id) };
  }
  error(code) { return { data: null, error: { code, message: 'sim ' + code } }; }

  ejecutar() {
    if (this.tabla === 'usuarios_roles') {
      return { data: [EMPRESA_A, EMPRESA_B].map((e) => ({ empresa_id: e, empresas: { nombre: e === EMPRESA_A ? 'Empresa A' : 'Empresa B' }, roles: { id: 'r', nombre: 'Administrador', roles_permisos: PERMISOS.map((codigo) => ({ permisos: { codigo } })) } })), error: null };
    }
    if (this.op === 'insert') {
      const fila = { id: uuid(), estado: 'activo', ...this.payload };
      const unicos = this.tabla === 'operadores' ? ['cedula'] : ['nombre'];
      const choca = db[this.tabla].some((f) => f.empresa_id === fila.empresa_id && unicos.every((k) => lc(f[k]) === lc(fila[k])));
      if (choca) return this.error('23505');
      db[this.tabla].push(fila);
      return { data: this.unico ? fila : [fila], error: null };
    }
    if (this.op === 'update') {
      const objetivo = this.filas()[0];
      if (!objetivo) return this.error('PGRST116');
      if (objetivo.estado === 'anonimizado') return this.error('23514');
      Object.assign(objetivo, this.payload);
      if (this.payload.estado === 'anonimizado') { objetivo.cedula = 'ANON-' + objetivo.id; objetivo.nombre = null; objetivo.apellido = null; }
      return { data: objetivo, error: null };
    }
    let filas = this.filas();
    const total = filas.length;
    if (this.rango) filas = filas.slice(this.rango[0], this.rango[1] + 1);
    filas = filas.map((f) => this.conEmbeds(f));
    if (this.unico) return { data: filas[0] ?? null, error: null };
    return { data: filas, error: null, count: this.contar ? total : null };
  }
}

let sesion = null;
const oyentes = [];
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: sesion } }),
      onAuthStateChange: (cb) => { oyentes.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async () => { sesion = { user: { id: USUARIO } }; return { data: { session: sesion }, error: null }; },
      signOut: async () => { sesion = null; return { error: null }; },
    },
    from: (tabla) => new Query(tabla),
    rpc: async (nombre, args) => {
      if (nombre !== 'registrar_evaluacion') return { data: null, error: { code: 'PGRST202', message: 'rpc desconocida' } };
      if (window.__E2E_RPC_FALLA__ > 0) { window.__E2E_RPC_FALLA__ -= 1; return { data: null, error: { code: '08006', message: 'sim red' } }; }
      const p = args.p;
      const duplicada = db.evaluaciones.some((e) => e.id === p.evaluacion_id);
      if (!duplicada) db.evaluaciones.push({ id: p.evaluacion_id, ...p });
      return { data: { evaluacion_id: p.evaluacion_id, duplicada }, error: null };
    },
  };
}
`;

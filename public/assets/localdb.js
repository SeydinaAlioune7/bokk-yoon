// Adaptateur qui donne à une base sql.js (SQLite WebAssembly) la même interface que Cloudflare D1.
// Permet d'exécuter server.js tel quel dans le navigateur (mode démo hors ligne) et dans les tests Node.

const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function d1Adapter(sqlDb, onWrite) {
  return {
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...p) { params = p.map(clean); return stmt; },
        async all() {
          const s = sqlDb.prepare(sql);
          try {
            if (params.length) s.bind(params);
            const rows = [];
            while (s.step()) rows.push(s.getAsObject());
            return { results: rows };
          } finally { s.free(); }
        },
        async first() { return (await stmt.all()).results[0] || null; },
        async run() {
          sqlDb.run(sql, params);
          const changes = sqlDb.getRowsModified();
          if (onWrite) onWrite();
          return { meta: { changes } };
        },
      };
      return stmt;
    },
  };
}

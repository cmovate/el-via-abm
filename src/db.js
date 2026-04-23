const { Pool } = require('pg');

let _pool = null;

function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) return null;
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    _pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err.message);
    });
  }
  return _pool;
}

// Called by setup wizard after DATABASE_URL is set
function reinit() {
  if (_pool) {
    _pool.end().catch(() => {});
    _pool = null;
  }
}

module.exports = {
  query: (text, params) => {
    const pool = getPool();
    if (!pool) return Promise.reject(new Error('Database not configured. Complete setup at /setup.html'));
    return pool.query(text, params);
  },
  get pool() { return getPool(); },
  reinit,
};

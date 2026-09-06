const { createPool } = require('@vercel/postgres');

// Интеграция Neon на Vercel добавляет переменные с префиксом (например
// DRustApp_POSTGRES_URL), а не как POSTGRES_URL, которую по умолчанию
// ищет @vercel/postgres. Поэтому подключение создаём явно, с fallback
// на непрефиксованное имя на случай, если он у тебя когда-нибудь поменяется.
const connectionString =
  process.env.DRustApp_POSTGRES_URL ||
  process.env.POSTGRES_URL;

console.log('[db.js] has DRustApp_POSTGRES_URL:', !!process.env.DRustApp_POSTGRES_URL);
console.log('[db.js] has POSTGRES_URL:', !!process.env.POSTGRES_URL);
console.log('[db.js] connectionString prefix:', connectionString ? connectionString.slice(0, 15) : 'MISSING');

if (!connectionString) {
  throw new Error('Missing DRustApp_POSTGRES_URL / POSTGRES_URL env var');
}

let pool;
try {
  pool = createPool({ connectionString });
} catch (err) {
  console.error('[db.js] createPool failed:', err.message);
  throw err;
}

module.exports = { sql: pool.sql };

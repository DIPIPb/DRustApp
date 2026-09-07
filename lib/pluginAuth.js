const { sql } = require('./db');

// Verifies the RustApp plugin's x-plugin-auth header and returns the server row.
// Usage inside an api handler:
//   const server = await requirePluginAuth(req, res);
//   if (!server) return; // response already sent
async function requirePluginAuth(req, res) {
  const token = req.headers['x-plugin-auth'];
  if (!token) {
    res.status(401).json({ ok: false, error: 'missing_token' });
    return null;
  }

  const { rows } = await sql`select * from servers where token = ${token} limit 1`;
  if (!rows[0]) {
    res.status(401).json({ ok: false, error: 'invalid_token' });
    return null;
  }

  await sql`update servers set last_seen_at = now() where id = ${rows[0].id}`;
  return rows[0];
}

function readJsonBody(req) {
  // Vercel Node functions already parse JSON bodies into req.body when
  // Content-Type: application/json is set.
  return req.body || {};
}

module.exports = { requirePluginAuth, readJsonBody };

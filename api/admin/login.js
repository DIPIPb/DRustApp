const { sql } = require('../../lib/db');
const { verifyPassword, createSession } = require('../../lib/adminAuth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const { rows } = await sql`select * from admin_accounts where username = ${username} and active = true limit 1`;
  const account = rows[0];
  if (!account || !verifyPassword(password, account.hash, account.salt)) {
    return res.status(401).json({ ok: false, error: 'invalid_credentials' });
  }

  const token = await createSession(account.id);
  await sql`update admin_accounts set last_login_at = now() where id = ${account.id}`;

  res.status(200).json({ ok: true, token, username: account.username, role: account.role });
};

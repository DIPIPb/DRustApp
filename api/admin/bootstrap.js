const { sql } = require('../../lib/db');
const { hashPassword } = require('../../lib/adminAuth');

// One-time setup: POST { secret, username, password } where secret === process.env.BOOTSTRAP_SECRET
// Only works while there are zero admin accounts — disable/delete this file after first use.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { secret, username, password } = req.body || {};
  if (!process.env.BOOTSTRAP_SECRET || secret !== process.env.BOOTSTRAP_SECRET) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const { rows } = await sql`select count(*)::int as c from admin_accounts`;
  if (rows[0].c > 0) return res.status(409).json({ ok: false, error: 'already_bootstrapped' });

  const { hash, salt } = hashPassword(password);
  await sql`insert into admin_accounts (username, hash, salt, role) values (${username}, ${hash}, ${salt}, 'superadmin')`;

  res.status(200).json({ ok: true });
};

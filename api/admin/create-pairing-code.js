const crypto = require('crypto');
const { sql } = require('../../lib/db');
const { requireAdminAuth } = require('../../lib/adminAuth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  await sql`insert into pairing_codes (code) values (${code})`;

  res.status(200).json({ ok: true, code });
};

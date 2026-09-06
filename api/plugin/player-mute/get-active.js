const { sql } = require('../../../lib/db');
const { requirePluginAuth } = require('../../../lib/pluginAuth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const { rows } = await sql`select steam_id, reason, expires_at from mutes where server_id = ${server.id} and active = true`;
  res.status(200).json(rows);
};

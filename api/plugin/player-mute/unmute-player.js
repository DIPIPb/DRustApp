const { sql } = require('../../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../../lib/pluginAuth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const b = readJsonBody(req);
  if (!b.steam_id) return res.status(400).json({ ok: false, error: 'missing_steam_id' });

  await sql`update mutes set active = false where server_id = ${server.id} and steam_id = ${b.steam_id} and active = true`;

  res.status(200).json({ ok: true });
};

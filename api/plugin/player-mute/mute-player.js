const { sql } = require('../../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../../lib/pluginAuth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const b = readJsonBody(req);
  if (!b.steam_id) return res.status(400).json({ ok: false, error: 'missing_steam_id' });

  const expiresAt = b.expires_at || null;
  await sql`
    insert into mutes (server_id, steam_id, reason, expires_at)
    values (${server.id}, ${b.steam_id}, ${b.reason || null}, ${expiresAt})
  `;

  res.status(200).json({ ok: true });
};

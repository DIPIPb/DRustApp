const { sql } = require('../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../lib/pluginAuth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const b = readJsonBody(req);
  if (!b.target_steam_id) return res.status(400).json({ ok: false, error: 'missing_target_steam_id' });

  await sql`
    insert into bans (server_id, target_steam_id, reason, global, ban_ip, duration, comment)
    values (${server.id}, ${b.target_steam_id}, ${b.reason || null}, ${!!b.global}, ${!!b.ban_ip}, ${b.duration || null}, ${b.comment || null})
  `;

  res.status(200).json({ ok: true });
};

const { sql } = require('../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../lib/pluginAuth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const body = readJsonBody(req);
  const reports = body.reports || [];

  for (const r of reports) {
    await sql`
      insert into reports (server_id, initiator_steam_id, target_steam_id, sub_targets_steam_ids, reason, message)
      values (${server.id}, ${r.initiator_steam_id || null}, ${r.target_steam_id || null}, ${JSON.stringify(r.sub_targets_steam_ids || [])}, ${r.reason || null}, ${r.message || null})
    `;
  }

  res.status(200).json({ ok: true });
};

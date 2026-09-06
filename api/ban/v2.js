const { sql } = require('../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../lib/pluginAuth');

// POST /ban/v2 -> batch-check a list of steam ids against active bans on this server.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const body = readJsonBody(req);
  const ids = (body.entries || []).map(e => e.target_steam_id).filter(Boolean);
  if (ids.length === 0) return res.status(200).json({ bans: [] });

  const { rows } = await sql`
    select target_steam_id, reason from bans
    where server_id = ${server.id} and active = true and target_steam_id = any(${ids})
  `;

  res.status(200).json({ bans: rows });
};

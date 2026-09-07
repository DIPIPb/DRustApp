const { sql } = require('../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../lib/pluginAuth');

// Объединённый обработчик /plugin/player-mute/* — чтобы не превышать лимит
// serverless-функций на Hobby-плане Vercel.
// Маршрутизация через vercel.json: /plugin/player-mute/:action -> /api/plugin/player-mute?action=:action

async function getActive(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const { rows } = await sql`select steam_id, reason, expires_at from mutes where server_id = ${server.id} and active = true`;
  res.status(200).json(rows);
}

async function mutePlayer(req, res) {
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
}

async function unmutePlayer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const b = readJsonBody(req);
  if (!b.steam_id) return res.status(400).json({ ok: false, error: 'missing_steam_id' });

  await sql`update mutes set active = false where server_id = ${server.id} and steam_id = ${b.steam_id} and active = true`;

  res.status(200).json({ ok: true });
}

const ACTIONS = {
  'get-active': getActive,
  'mute-player': mutePlayer,
  'unmute-player': unmutePlayer,
};

module.exports = async (req, res) => {
  const action = req.query.action;
  const handler = ACTIONS[action];
  if (!handler) return res.status(404).json({ ok: false, error: 'unknown_action' });
  return handler(req, res);
};

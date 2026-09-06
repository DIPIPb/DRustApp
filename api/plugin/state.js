const { sql } = require('../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../lib/pluginAuth');

module.exports = async (req, res) => {
  if (req.method !== 'PUT') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const body = readJsonBody(req);
  const players = body.players || [];

  for (const p of players) {
    await sql`
      insert into players (server_id, steam_id, steam_name, ip, status, ping, is_alive, meta, last_seen_at)
      values (${server.id}, ${p.steam_id}, ${p.steam_name || null}, ${p.ip || null}, ${p.status || null}, ${p.ping || null}, ${p.is_alive ?? null}, ${JSON.stringify(p.meta || {})}, now())
      on conflict (server_id, steam_id) do update set
        steam_name = excluded.steam_name,
        ip = excluded.ip,
        status = excluded.status,
        ping = excluded.ping,
        is_alive = excluded.is_alive,
        meta = excluded.meta,
        last_seen_at = now()
    `;
  }

  const disconnected = Object.keys(body.disconnected || {});
  for (const steamId of disconnected) {
    await sql`update players set status = 'offline' where server_id = ${server.id} and steam_id = ${steamId}`;
  }

  res.status(200).json({ ok: true });
};

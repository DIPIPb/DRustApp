const crypto = require('crypto');
const { sql } = require('../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../lib/pluginAuth');

// Объединённый обработчик основных /plugin/* маршрутов — чтобы не превышать
// лимит serverless-функций на Hobby-плане Vercel (12 функций на проект).
// Маршрутизация делается через vercel.json: /plugin/<x> -> /api/plugin/core?action=<x>

async function index(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const server = await requirePluginAuth(req, res);
  if (!server) return;
  res.status(200).json({ ok: true, server_id: server.id });
}

// The plugin calls this endpoint TWICE in a row:
//  1) once immediately when the admin runs `ra.pair <code>` in console
//  2) then every 1 second after that (WaitPairFinish) until the response
//     contains a non-empty token.
// So this handler must be idempotent for a given code: the first call creates
// the server + token, every following call with the same code just returns
// the same token again.
async function pair(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const code = req.query.code;
  if (!code) return res.status(400).json({ ok: false, error: 'missing_code' });

  const { rows: codes } = await sql`select * from pairing_codes where code = ${code} limit 1`;
  const pairingRow = codes[0];
  if (!pairingRow) return res.status(404).json({ ok: false, error: 'code not exists' });

  if (pairingRow.server_id) {
    const { rows: servers } = await sql`select token from servers where id = ${pairingRow.server_id} limit 1`;
    if (servers[0]) return res.status(200).json({ ttl: 86400, token: servers[0].token });
  }

  const body = req.body || {};
  const token = crypto.randomBytes(24).toString('hex');

  const { rows: inserted } = await sql`
    insert into servers (token, hostname, port, world_size, level, description, version)
    values (${token}, ${body.hostname || null}, ${body.port || null}, ${body.world_size || null}, ${body.level || null}, ${body.description || null}, ${body.version || null})
    returning id
  `;

  await sql`update pairing_codes set used = true, server_id = ${inserted[0].id} where code = ${code}`;

  res.status(200).json({ ttl: 86400, token });
}

async function state(req, res) {
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
}

async function chat(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const body = readJsonBody(req);
  const messages = body.messages || [];

  for (const m of messages) {
    await sql`
      insert into chat_messages (server_id, steam_id, target_steam_id, is_team, text)
      values (${server.id}, ${m.steam_id || null}, ${m.target_steam_id || null}, ${!!m.is_team}, ${m.text || ''})
    `;
  }

  res.status(200).json({ ok: true });
}

async function reports(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const body = readJsonBody(req);
  const reportsList = body.reports || [];

  for (const r of reportsList) {
    await sql`
      insert into reports (server_id, initiator_steam_id, target_steam_id, sub_targets_steam_ids, reason, message)
      values (${server.id}, ${r.initiator_steam_id || null}, ${r.target_steam_id || null}, ${JSON.stringify(r.sub_targets_steam_ids || [])}, ${r.reason || null}, ${r.message || null})
    `;
  }

  res.status(200).json({ ok: true });
}

async function ban(req, res) {
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
}

async function unban(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const b = readJsonBody(req);
  if (!b.target_steam_id) return res.status(400).json({ ok: false, error: 'missing_target_steam_id' });

  await sql`update bans set active = false where server_id = ${server.id} and target_steam_id = ${b.target_steam_id} and active = true`;

  res.status(200).json({ ok: true });
}

async function contact(req, res) {
  const server = await requirePluginAuth(req, res);
  if (!server) return;
  res.status(200).json({ ok: true });
}

async function wipe(req, res) {
  const server = await requirePluginAuth(req, res);
  if (!server) return;
  res.status(200).json({ ok: true });
}

const ACTIONS = { index, pair, state, chat, reports, ban, unban, contact, wipe };

module.exports = async (req, res) => {
  const action = req.query.action;
  const handler = ACTIONS[action];
  if (!handler) return res.status(404).json({ ok: false, error: 'unknown_action' });
  return handler(req, res);
};

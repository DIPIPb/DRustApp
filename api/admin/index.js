const crypto = require('crypto');
const { sql } = require('../../lib/db');
const { requireAdminAuth, hashPassword, verifyPassword, createSession } = require('../../lib/adminAuth');
const { getGeoForIps } = require('../../lib/geoip');
const { getFallbackMapImageUrl } = require('../../lib/rustMaps');
const { getAvatarsForSteamIds } = require('../../lib/steamAvatar');

// Единая функция для всех /api/admin/* маршрутов — объединено, чтобы не упираться
// в лимит serverless-функций на Hobby-плане Vercel (12 функций на проект).
// Маршрутизация делается через vercel.json: /api/admin/:action -> /api/admin/index?action=:action

async function bootstrap(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { secret, username, password } = req.body || {};
  if (!process.env.BOOTSTRAP_SECRET || secret !== process.env.BOOTSTRAP_SECRET) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const { rows } = await sql`select count(*)::int as c from admin_accounts`;
  if (rows[0].c > 0) return res.status(409).json({ ok: false, error: 'already_bootstrapped' });

  const { hash, salt } = hashPassword(password);
  await sql`insert into admin_accounts (username, hash, salt, role) values (${username}, ${hash}, ${salt}, 'superadmin')`;

  res.status(200).json({ ok: true });
}

async function login(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const { rows } = await sql`select * from admin_accounts where username = ${username} and active = true limit 1`;
  const account = rows[0];
  if (!account || !verifyPassword(password, account.hash, account.salt)) {
    return res.status(401).json({ ok: false, error: 'invalid_credentials' });
  }

  const token = await createSession(account.id);
  await sql`update admin_accounts set last_login_at = now() where id = ${account.id}`;

  res.status(200).json({ ok: true, token, username: account.username, role: account.role });
}

async function logout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const token = req.headers['x-auth-token'] || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token) await sql`delete from admin_sessions where token = ${token}`;
  res.status(200).json({ ok: true });
}

async function me(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;
  res.status(200).json({ ok: true, username: session.username, role: session.role });
}

async function players(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const { rows } = await sql`
    select steam_id, steam_name, status, is_alive, ip, coords, can_build, last_seen_at,
      case
        when status in ('active', 'joining', 'in_queue') and last_seen_at < now() - interval '20 seconds'
        then 'offline'
        else status
      end as effective_status
    from players
    order by
      case
        when status in ('active', 'joining', 'in_queue') and last_seen_at < now() - interval '20 seconds' then 3
        else case status when 'active' then 0 when 'joining' then 1 when 'in_queue' then 2 else 3 end
      end,
      last_seen_at desc
    limit 300
  `;

  const geoMap = await getGeoForIps(rows.map(p => p.ip));
  const avatarMap = await getAvatarsForSteamIds(rows.map(p => p.steam_id));

  const enriched = rows.map(p => ({
    ...p,
    status: p.effective_status,
    geo: p.ip ? (geoMap[p.ip] || null) : null,
    avatar_url: avatarMap[p.steam_id] || null,
  }));

  res.status(200).json(enriched);
}

async function chat(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const serverId = req.query.server_id;
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);

  const { rows } = serverId
    ? await sql`
        select cm.*, p.steam_name, p.avatar_url as cached_avatar_url
        from chat_messages cm
        left join players p on p.steam_id = cm.steam_id
        where cm.server_id = ${serverId}
        order by cm.created_at desc limit ${limit}
      `
    : await sql`
        select cm.*, p.steam_name, p.avatar_url as cached_avatar_url
        from chat_messages cm
        left join players p on p.steam_id = cm.steam_id
        order by cm.created_at desc limit ${limit}
      `;

  const avatarMap = await getAvatarsForSteamIds(rows.map(r => r.steam_id));

  const enriched = rows.map(r => ({
    ...r,
    avatar_url: avatarMap[r.steam_id] || r.cached_avatar_url || null,
  }));

  res.status(200).json(enriched);
}

async function reports(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const serverId = req.query.server_id;
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);

  const { rows } = serverId
    ? await sql`select * from reports where server_id = ${serverId} order by created_at desc limit ${limit}`
    : await sql`select * from reports order by created_at desc limit ${limit}`;

  res.status(200).json(rows);
}

async function map(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  let serverId = req.query.server_id;

  if (!serverId) {
    const { rows } = await sql`select id from servers order by last_seen_at desc nulls last limit 1`;
    if (!rows[0]) return res.status(200).json({ ok: true, server: null, players: [] });
    serverId = rows[0].id;
  }

  const { rows: serverRows } = await sql`
    select id, hostname, level, world_size, seed, map_image_url, fallback_map_image_url, fallback_map_image_fetched_at, last_seen_at
    from servers where id = ${serverId} limit 1
  `;
  const server = serverRows[0];
  if (!server) return res.status(404).json({ ok: false, error: 'server_not_found' });

  // Приоритет — картинка от самого плагина (MapUploader, точный снимок
  // текущего мира). Если плагин её не смог получить (например, старая
  // сборка сервера без этого класса) — идём в RustMaps по seed.
  let mapImageUrl = server.map_image_url;
  if (!mapImageUrl) {
    mapImageUrl = await getFallbackMapImageUrl(server);
  }

  const { rows: players } = await sql`
    select steam_id, steam_name,
      case
        when status in ('active', 'joining', 'in_queue') and last_seen_at < now() - interval '20 seconds'
        then 'offline'
        else status
      end as status,
      is_alive, pos_x, pos_z, coords, can_build, is_raiding, last_seen_at
    from players
    where server_id = ${serverId} and pos_x is not null and pos_z is not null
      and last_seen_at > now() - interval '2 minutes'
    order by last_seen_at desc
  `;

  res.status(200).json({ ok: true, server: { ...server, map_image_url: mapImageUrl }, players });
}

async function stats(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const range = req.query.range || '24h';
  const RANGE_TO_INTERVAL = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
  const interval = RANGE_TO_INTERVAL[range] || '24 hours';

  let serverId = req.query.server_id;
  if (!serverId) {
    const { rows } = await sql`select id from servers order by last_seen_at desc nulls last limit 1`;
    if (!rows[0]) return res.status(200).json({ ok: true, server: null, history: [], staff: [] });
    serverId = rows[0].id;
  }

  const { rows: serverRows } = await sql`
    select id, hostname, port, world_size, level, version, active_count, joining_count, queued_count, reserved_count, slots, paired_at, last_seen_at
    from servers where id = ${serverId} limit 1
  `;
  const server = serverRows[0];
  if (!server) return res.status(404).json({ ok: false, error: 'server_not_found' });

  const { rows: history } = await sql`
    select active_count, joining_count, queued_count, slots, created_at
    from server_stats_history
    where server_id = ${serverId} and created_at > now() - ${interval}::interval
    order by created_at asc
  `;

  const { rows: staff } = await sql`
    select username, role, created_at from admin_accounts order by created_at asc
  `;

  res.status(200).json({ ok: true, server, history, staff });
}

function pickServerId(req) {
  return req.query.server_id || null;
}

async function resolveServerId(req) {
  const explicit = pickServerId(req);
  if (explicit) return explicit;
  const { rows } = await sql`select id from servers order by last_seen_at desc nulls last limit 1`;
  return rows[0] ? rows[0].id : null;
}

async function enqueueTask(serverId, name, data) {
  const id = crypto.randomUUID();
  await sql`
    insert into queue_tasks (id, server_id, name, data)
    values (${id}, ${serverId}, ${name}, ${JSON.stringify(data || {})})
  `;
  return id;
}

// POST /api/admin/kick-player -> { steam_id, reason }
async function kickPlayer(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const b = req.body || {};
  if (!b.steam_id) return res.status(400).json({ ok: false, error: 'missing_steam_id' });

  const serverId = await resolveServerId(req);
  if (!serverId) return res.status(404).json({ ok: false, error: 'no_server' });

  const taskId = await enqueueTask(serverId, 'kick', { steam_id: b.steam_id, reason: b.reason || 'Kicked by admin', announce: false });
  res.status(200).json({ ok: true, task_id: taskId });
}

// POST /api/admin/execute-command -> { commands: ["say hello", ...] }
async function executeCommand(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const b = req.body || {};
  const commands = Array.isArray(b.commands) ? b.commands : (b.command ? [b.command] : []);
  if (!commands.length) return res.status(400).json({ ok: false, error: 'missing_commands' });

  const serverId = await resolveServerId(req);
  if (!serverId) return res.status(404).json({ ok: false, error: 'no_server' });

  const taskId = await enqueueTask(serverId, 'execute-command', { commands });
  res.status(200).json({ ok: true, task_id: taskId });
}

// GET /api/admin/task-result?task_id=... -> проверить результат отправленной задачи
async function taskResult(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const taskId = req.query.task_id;
  if (!taskId) return res.status(400).json({ ok: false, error: 'missing_task_id' });

  const { rows } = await sql`select status, result from queue_tasks where id = ${taskId} limit 1`;
  if (!rows[0]) return res.status(404).json({ ok: false, error: 'not_found' });

  res.status(200).json({ ok: true, status: rows[0].status, result: rows[0].result });
}

// POST /api/admin/mute-player -> { steam_id, reason, duration_minutes }
async function mutePlayer(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const b = req.body || {};
  if (!b.steam_id) return res.status(400).json({ ok: false, error: 'missing_steam_id' });

  const serverId = await resolveServerId(req);
  if (!serverId) return res.status(404).json({ ok: false, error: 'no_server' });

  const expiresAt = b.duration_minutes ? new Date(Date.now() + b.duration_minutes * 60000).toISOString() : null;

  await sql`
    insert into mutes (server_id, steam_id, reason, expires_at, created_by)
    values (${serverId}, ${b.steam_id}, ${b.reason || null}, ${expiresAt}, ${session.username || null})
  `;

  res.status(200).json({ ok: true });
}

// POST /api/admin/unmute-player -> { steam_id }
async function unmutePlayer(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const b = req.body || {};
  if (!b.steam_id) return res.status(400).json({ ok: false, error: 'missing_steam_id' });

  const serverId = await resolveServerId(req);
  await sql`update mutes set active = false where server_id = ${serverId} and steam_id = ${b.steam_id} and active = true`;

  res.status(200).json({ ok: true });
}

// GET /api/admin/mutes -> список активных мутов
async function listMutes(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const serverId = await resolveServerId(req);
  const { rows } = await sql`
    select m.steam_id, p.steam_name, m.reason, m.expires_at, m.created_by, m.created_at
    from mutes m
    left join players p on p.steam_id = m.steam_id and p.server_id = m.server_id
    where m.server_id = ${serverId} and m.active = true
    order by m.created_at desc
  `;
  res.status(200).json(rows);
}

// POST /api/admin/ban-player -> { steam_id, reason }
async function banPlayer(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const b = req.body || {};
  if (!b.steam_id) return res.status(400).json({ ok: false, error: 'missing_steam_id' });

  const serverId = await resolveServerId(req);
  if (!serverId) return res.status(404).json({ ok: false, error: 'no_server' });

  await sql`
    insert into bans (server_id, target_steam_id, reason, comment, active)
    values (${serverId}, ${b.steam_id}, ${b.reason || null}, ${'Ban via panel by ' + (session.username || 'admin')}, true)
  `;

  // Если игрок сейчас на сервере — сразу выкидываем, а не ждём, пока он
  // переподключится и попадёт под проверку бана.
  await enqueueTask(serverId, 'kick', { steam_id: b.steam_id, reason: b.reason || 'Banned', announce: false });

  res.status(200).json({ ok: true });
}

// POST /api/admin/unban-player -> { steam_id }
async function unbanPlayer(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const b = req.body || {};
  if (!b.steam_id) return res.status(400).json({ ok: false, error: 'missing_steam_id' });

  const serverId = await resolveServerId(req);
  await sql`update bans set active = false where server_id = ${serverId} and target_steam_id = ${b.steam_id} and active = true`;

  res.status(200).json({ ok: true });
}

// GET /api/admin/bans -> список активных банов
async function listBans(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const serverId = await resolveServerId(req);
  const { rows } = await sql`
    select b.target_steam_id, p.steam_name, b.reason, b.comment, b.created_at
    from bans b
    left join players p on p.steam_id = b.target_steam_id and p.server_id = b.server_id
    where b.server_id = ${serverId} and b.active = true
    order by b.created_at desc
  `;
  res.status(200).json(rows);
}

// GET /api/admin/alerts -> лента алертов (join-with-ip-ban, dug-up-stash, custom и т.д.)
async function alerts(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const serverId = await resolveServerId(req);
  const { rows } = await sql`
    select type, message, meta, created_at from player_alerts
    where server_id = ${serverId}
    order by created_at desc limit 200
  `;
  res.status(200).json(rows);
}

// GET /api/admin/kills -> лента убийств
async function kills(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const serverId = await resolveServerId(req);
  const { rows } = await sql`
    select k.initiator_steam_id, ip.steam_name as initiator_name,
      k.target_steam_id, tp.steam_name as target_name,
      k.weapon, k.distance, k.is_headshot, k.created_at
    from kills k
    left join players ip on ip.steam_id = k.initiator_steam_id and ip.server_id = k.server_id
    left join players tp on tp.steam_id = k.target_steam_id and tp.server_id = k.server_id
    where k.server_id = ${serverId}
    order by k.created_at desc limit 200
  `;
  res.status(200).json(rows);
}

async function createPairingCode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  await sql`insert into pairing_codes (code) values (${code})`;

  res.status(200).json({ ok: true, code });
}

const ACTIONS = {
  bootstrap,
  login,
  logout,
  me,
  players,
  chat,
  reports,
  map,
  stats,
  'kick-player': kickPlayer,
  'execute-command': executeCommand,
  'task-result': taskResult,
  'mute-player': mutePlayer,
  'unmute-player': unmutePlayer,
  mutes: listMutes,
  'ban-player': banPlayer,
  'unban-player': unbanPlayer,
  bans: listBans,
  alerts,
  kills,
  'create-pairing-code': createPairingCode,
};

module.exports = async (req, res) => {
  const action = req.query.action;
  const handler = ACTIONS[action];
  if (!handler) return res.status(404).json({ ok: false, error: 'unknown_action' });
  return handler(req, res);
};

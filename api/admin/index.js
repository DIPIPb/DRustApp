const crypto = require('crypto');
const { sql } = require('../../lib/db');
const { requireAdminAuth, hashPassword, verifyPassword, createSession } = require('../../lib/adminAuth');
const { getMapImageUrl } = require('../../lib/rustMaps');
const { getGeoForIps } = require('../../lib/geoip');

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
    select steam_id, steam_name, status, is_alive, ip, coords, can_build, last_seen_at
    from players
    order by
      case status when 'active' then 0 when 'joining' then 1 when 'in_queue' then 2 else 3 end,
      last_seen_at desc
    limit 300
  `;

  const geoMap = await getGeoForIps(rows.map(p => p.ip));

  const enriched = rows.map(p => ({
    ...p,
    geo: p.ip ? (geoMap[p.ip] || null) : null,
  }));

  res.status(200).json(enriched);
}

async function chat(req, res) {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const serverId = req.query.server_id;
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);

  const { rows } = serverId
    ? await sql`select * from chat_messages where server_id = ${serverId} order by created_at desc limit ${limit}`
    : await sql`select * from chat_messages order by created_at desc limit ${limit}`;

  res.status(200).json(rows);
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
    select id, hostname, level, world_size, seed, map_image_url, map_image_fetched_at, last_seen_at
    from servers where id = ${serverId} limit 1
  `;
  const server = serverRows[0];
  if (!server) return res.status(404).json({ ok: false, error: 'server_not_found' });

  const mapImageUrl = await getMapImageUrl(server);

  const { rows: players } = await sql`
    select steam_id, steam_name, status, is_alive, pos_x, pos_z, coords, can_build, is_raiding, last_seen_at
    from players
    where server_id = ${serverId} and pos_x is not null and pos_z is not null
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
    select id, hostname, port, world_size, level, version, active_count, joining_count, queued_count, slots, paired_at, last_seen_at
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
  'create-pairing-code': createPairingCode,
};

module.exports = async (req, res) => {
  const action = req.query.action;
  const handler = ACTIONS[action];
  if (!handler) return res.status(404).json({ ok: false, error: 'unknown_action' });
  return handler(req, res);
};

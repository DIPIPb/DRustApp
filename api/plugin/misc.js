const { sql } = require('../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../lib/pluginAuth');

// POST /plugin/alerts -> { alerts: [{ type, meta }, ...] }
async function alerts(req, res, server) {
  const body = readJsonBody(req);
  const list = body.alerts || [];

  for (const a of list) {
    await sql`
      insert into player_alerts (server_id, type, message, meta)
      values (${server.id}, ${a.type || null}, null, ${JSON.stringify(a.meta || {})})
    `;
  }

  res.status(200).json({ ok: true });
}

// POST /plugin/custom-alert -> { msg, data, custom_icon, hide_in_table, category, custom_links }
async function customAlert(req, res, server) {
  const body = readJsonBody(req);

  await sql`
    insert into player_alerts (server_id, type, message, meta)
    values (${server.id}, 'custom', ${body.msg || null}, ${JSON.stringify({
      data: body.data || null,
      custom_icon: body.custom_icon || null,
      category: body.category || null,
      custom_links: body.custom_links || [],
    })})
  `;

  res.status(200).json({ ok: true });
}

// POST /plugin/signage -> создать вывеску, DELETE /plugin/signage -> пометить удалённой
async function signage(req, res, server) {
  if (req.method === 'DELETE') {
    const body = readJsonBody(req);
    const netIds = body.net_ids || [];
    if (netIds.length) {
      await sql`
        update signage set destroyed_at = now()
        where server_id = ${server.id} and net_id = any(${netIds})
      `;
    }
    return res.status(200).json({ ok: true });
  }

  const body = readJsonBody(req);
  await sql`
    insert into signage (server_id, net_id, steam_id, sign_type, position, square, image_data)
    values (${server.id}, ${String(body.net_id || '')}, ${body.steam_id || null}, ${body.type || null}, ${body.position || null}, ${body.square || null}, ${body.base64_image || null})
  `;

  res.status(200).json({ ok: true });
}

// POST /plugin/kills -> { kills: [{ initiator_steam_id, target_steam_id, weapon, distance, is_headshot, game_time, hit_history }] }
// Полный combat-лог (hit_history) не храним — слишком объёмно для каждой БД,
// сохраняем только сводку по убийству. Если понадобится детальный лог, можно
// добавить отдельную таблицу позже.
async function kills(req, res, server) {
  const body = readJsonBody(req);
  const list = body.kills || [];

  for (const k of list) {
    await sql`
      insert into kills (server_id, initiator_steam_id, target_steam_id, weapon, distance, is_headshot, game_time)
      values (${server.id}, ${k.initiator_steam_id || null}, ${k.target_steam_id || null}, ${k.weapon || null}, ${k.distance || null}, ${k.is_headshot ?? false}, ${k.game_time || null})
    `;
  }

  res.status(200).json({ ok: true });
}

const ACTIONS = { alerts, 'custom-alert': customAlert, signage, kills };

module.exports = async (req, res) => {
  const server = await requirePluginAuth(req, res);
  if (!server) return;

  const handler = ACTIONS[req.query.action];
  if (!handler) return res.status(200).json({ ok: true }); // sleeping-bag и прочее пока просто подтверждаем

  return handler(req, res, server);
};

const { sql } = require('../../lib/db');
const { requirePluginAuth } = require('../../lib/pluginAuth');

// GET /queue-root -> плагин раз в секунду забирает необработанные задачи для
//   своего сервера (kick / execute-command / delete-entity и т.д.), помечаем
//   их как "sent", чтобы не выдавать повторно, пока не пришёл результат.
// PUT /queue-root -> плагин присылает { data: { taskId: result, ... } },
//   сохраняем результат и закрываем задачи.

module.exports = async (req, res) => {
  const server = await requirePluginAuth(req, res);
  if (!server) return;

  if (req.method === 'GET') {
    const { rows } = await sql`
      select id, name, data from queue_tasks
      where server_id = ${server.id} and status = 'pending'
      order by created_at asc
      limit 20
    `;

    if (rows.length) {
      const ids = rows.map(r => r.id);
      await sql`update queue_tasks set status = 'sent' where id = any(${ids})`;
    }

    const payload = rows.map(r => ({ id: r.id, request: { name: r.name, data: r.data || {} } }));
    return res.status(200).json(payload);
  }

  if (req.method === 'PUT') {
    const body = req.body || {};
    const results = body.data || {};

    for (const [taskId, result] of Object.entries(results)) {
      await sql`
        update queue_tasks set status = 'completed', result = ${JSON.stringify(result)}, completed_at = now()
        where id = ${taskId} and server_id = ${server.id}
      `;
    }

    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ ok: false, error: 'method_not_allowed' });
};

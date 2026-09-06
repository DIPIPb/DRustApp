const { sql } = require('../../lib/db');
const { requirePluginAuth, readJsonBody } = require('../../lib/pluginAuth');

module.exports = async (req, res) => {
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
};

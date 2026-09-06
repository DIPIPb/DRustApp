const { requirePluginAuth } = require('../../lib/pluginAuth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const server = await requirePluginAuth(req, res);
  if (!server) return;
  res.status(200).json({ ok: true, server_id: server.id });
};

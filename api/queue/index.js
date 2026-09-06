const { requirePluginAuth } = require('../../lib/pluginAuth');

// GET  /queue  -> plugin polls for queued tasks (we have none yet, always empty)
// PUT  /queue  -> plugin reports task results (we just acknowledge)
module.exports = async (req, res) => {
  const server = await requirePluginAuth(req, res);
  if (!server) return;

  if (req.method === 'GET') return res.status(200).json([]);
  if (req.method === 'PUT') return res.status(200).json({ ok: true });
  res.status(405).json({ ok: false, error: 'method_not_allowed' });
};

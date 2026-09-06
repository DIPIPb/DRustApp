const { requirePluginAuth } = require('../../lib/pluginAuth');

// Accepts any method/body, just checks auth and returns ok.
// Wire this up from a route file with: module.exports = require('../_stub');
module.exports = async (req, res) => {
  const server = await requirePluginAuth(req, res);
  if (!server) return;
  res.status(200).json({ ok: true });
};

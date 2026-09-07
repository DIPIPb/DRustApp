const { requirePluginAuth } = require('../../lib/pluginAuth');

// Второстепенные /plugin/* маршруты (signage, kills, alerts, custom-alert,
// sleeping-bag) — пока просто отвечают 200 OK и ничего не сохраняют, чтобы
// плагин не падал. Объединено в один файл, чтобы не превышать лимит
// serverless-функций на Hobby-плане Vercel.
module.exports = async (req, res) => {
  const server = await requirePluginAuth(req, res);
  if (!server) return;
  res.status(200).json({ ok: true });
};

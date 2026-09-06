const { requireAdminAuth } = require('../../lib/adminAuth');

module.exports = async (req, res) => {
  const session = await requireAdminAuth(req, res);
  if (!session) return;
  res.status(200).json({ ok: true, username: session.username, role: session.role });
};

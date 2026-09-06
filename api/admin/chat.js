const { sql } = require('../../lib/db');
const { requireAdminAuth } = require('../../lib/adminAuth');

module.exports = async (req, res) => {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const serverId = req.query.server_id;
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);

  const { rows } = serverId
    ? await sql`select * from chat_messages where server_id = ${serverId} order by created_at desc limit ${limit}`
    : await sql`select * from chat_messages order by created_at desc limit ${limit}`;

  res.status(200).json(rows);
};

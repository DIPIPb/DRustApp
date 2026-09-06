const { sql } = require('../../lib/db');
const { requireAdminAuth } = require('../../lib/adminAuth');

module.exports = async (req, res) => {
  const session = await requireAdminAuth(req, res);
  if (!session) return;

  const { rows } = await sql`
    select id, hostname, port, world_size, level, description, version, paired_at, last_seen_at,
      (select count(*) from players p where p.server_id = servers.id and p.status = 'active') as online_count
    from servers
    order by last_seen_at desc nulls last
  `;

  res.status(200).json(rows);
};

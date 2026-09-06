const crypto = require('crypto');
const { sql } = require('../../lib/db');

// The plugin calls this endpoint TWICE in a row:
//  1) once immediately when the admin runs `ra.pair <code>` in console
//  2) then every 1 second after that (WaitPairFinish) until the response
//     contains a non-empty token.
// So this handler must be idempotent for a given code: the first call creates
// the server + token, every following call with the same code just returns
// the same token again.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const code = req.query.code;
  if (!code) return res.status(400).json({ ok: false, error: 'missing_code' });

  const { rows: codes } = await sql`select * from pairing_codes where code = ${code} limit 1`;
  const pairingRow = codes[0];
  if (!pairingRow) return res.status(404).json({ ok: false, error: 'code not exists' });

  // Already claimed by a previous call with this code -> return the same token.
  if (pairingRow.server_id) {
    const { rows: servers } = await sql`select token from servers where id = ${pairingRow.server_id} limit 1`;
    if (servers[0]) return res.status(200).json({ ttl: 86400, token: servers[0].token });
  }

  const body = req.body || {};
  const token = crypto.randomBytes(24).toString('hex');

  const { rows: inserted } = await sql`
    insert into servers (token, hostname, port, world_size, level, description, version)
    values (${token}, ${body.hostname || null}, ${body.port || null}, ${body.world_size || null}, ${body.level || null}, ${body.description || null}, ${body.version || null})
    returning id
  `;

  await sql`update pairing_codes set used = true, server_id = ${inserted[0].id} where code = ${code}`;

  res.status(200).json({ ttl: 86400, token });
};

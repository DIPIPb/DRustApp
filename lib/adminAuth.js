const crypto = require('crypto');
const { sql } = require('./db');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.createHmac('sha256', salt).update(password).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
  } catch {
    return false;
  }
}

async function createSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sql`insert into admin_sessions (token, account_id, expires_at) values (${token}, ${accountId}, ${expiresAt.toISOString()})`;
  return token;
}

// Usage inside an api handler:
//   const session = await requireAdminAuth(req, res);
//   if (!session) return; // response already sent
async function requireAdminAuth(req, res) {
  const token = req.headers['x-auth-token'] || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return null;
  }

  const { rows } = await sql`
    select s.token, s.expires_at, a.id as account_id, a.username, a.role, a.active
    from admin_sessions s
    join admin_accounts a on a.id = s.account_id
    where s.token = ${token}
    limit 1
  `;

  const session = rows[0];
  if (!session || !session.active || new Date(session.expires_at) < new Date()) {
    res.status(401).json({ ok: false, error: 'invalid_or_expired_token' });
    return null;
  }

  return session;
}

module.exports = { hashPassword, verifyPassword, createSession, requireAdminAuth, SESSION_TTL_MS };

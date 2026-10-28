import crypto from 'node:crypto';

// Small, dependency-free auth: scrypt password hashes + HMAC-signed tokens.
// Good enough for a student project's demo; not meant for production traffic.
const SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash.length === check.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
}

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

export function signToken(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp < Date.now()) return null;
  return payload;
}

// Two roles: admin (create deployments, apply AI actions), viewer (read-only).
export function seedUsers(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const admin = { user: process.env.ADMIN_USER || 'admin', pass: process.env.ADMIN_PASSWORD || 'admin123' };
  const viewer = { user: process.env.VIEWER_USER || 'viewer', pass: process.env.VIEWER_PASSWORD || 'viewer123' };
  const insert = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  insert.run(admin.user, hashPassword(admin.pass), 'admin');
  insert.run(viewer.user, hashPassword(viewer.pass), 'viewer');
  console.log(`Seeded default users: ${admin.user}/${admin.pass} (admin), ${viewer.user}/${viewer.pass} (viewer) - change these in .env`);
}

// Express middleware: requires a valid token; optionally requires a role.
export function requireAuth(role) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = verifyToken(token);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });
    if (role && user.role !== role) return res.status(403).json({ error: `This action needs the ${role} role.` });
    req.user = user;
    next();
  };
}

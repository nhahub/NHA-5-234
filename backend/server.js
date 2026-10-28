import express from 'express';
import { db } from './db.js';
import { startDeployment, applyAction, orchestrator, target } from './runner.js';
import { advise, explainError } from './ai.js';
import { hashPassword, verifyPassword, signToken, seedUsers, requireAuth } from './auth.js';
import { TEMPLATES, templateById } from './templates.js';

seedUsers(db);

const app = express();
app.use(express.json());

const ENVIRONMENTS = ['dev', 'staging', 'prod'];

function validate(b = {}) {
  const name = String(b.name ?? '');
  const repoUrl = String(b.repoUrl ?? '');
  const replicas = Number(b.replicas);
  const appPort = Number(b.appPort ?? 3000);
  if (!/^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/.test(name)) return 'Name must be 3-30 characters: lowercase letters, numbers and hyphens.';
  if (!/^https:\/\/(github|gitlab)\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/.test(repoUrl)) return 'Repository URL must look like https://github.com/user/repo.';
  if (!ENVIRONMENTS.includes(b.environment)) return 'Environment must be dev, staging or prod.';
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > 5) return 'Replicas must be a whole number from 1 to 5.';
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) return 'Port must be between 1 and 65535.';
  if (b.template && !templateById(b.template)) return 'Unknown template.';
  return null;
}

const getDep = (id) => db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
const FIELDS = 'id, name, repo_url, environment, replicas, template, status, stage, app_url, created_at, finished_at';

// ---- Auth ----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const token = signToken({ sub: row.id, username: row.username, role: row.role });
  res.json({ token, username: row.username, role: row.role });
});
app.get('/api/me', requireAuth(), (req, res) => res.json(req.user));

// ---- Templates (read-only reference data, no auth needed) ----
app.get('/api/templates', (_req, res) => res.json(TEMPLATES));

// ---- Deployments: viewers can read, only admins can create or apply actions ----
app.post('/api/deployments', requireAuth('admin'), (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });
  const { name, repoUrl, environment, replicas, appPort = 3000, template = null } = req.body;
  const used = new Set(db.prepare('SELECT node_port FROM deployments').pluck().all());
  let nodePort = 30100;
  while (used.has(nodePort)) nodePort++;
  if (nodePort > 30199) return res.status(409).json({ error: 'No free ports left (limit: 100 deployments).' });
  const info = db.prepare(
    'INSERT INTO deployments (name, repo_url, environment, replicas, app_port, node_port, template) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, repoUrl, environment, replicas, appPort, nodePort, template);
  startDeployment(info.lastInsertRowid); // runs in the background
  res.status(201).json(getDep(info.lastInsertRowid));
});

app.get('/api/deployments', requireAuth(), (req, res) => {
  const { status, environment, q } = req.query;
  const clauses = []; const params = [];
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (environment) { clauses.push('environment = ?'); params.push(environment); }
  if (q) { clauses.push('name LIKE ?'); params.push(`%${q}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  res.json(db.prepare(`SELECT ${FIELDS} FROM deployments ${where} ORDER BY id DESC`).all(...params));
});

app.get('/api/deployments/:id', requireAuth(), (req, res) => {
  const dep = getDep(req.params.id);
  return dep ? res.json(dep) : res.status(404).json({ error: 'Deployment not found.' });
});

app.get('/api/deployments/:id/actions', requireAuth(), (req, res) => {
  if (!getDep(req.params.id)) return res.status(404).json({ error: 'Deployment not found.' });
  res.json(db.prepare('SELECT type, detail, created_at FROM actions WHERE deployment_id = ? ORDER BY id DESC').all(req.params.id));
});

const withDep = (fn) => async (req, res) => {
  const dep = getDep(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Deployment not found.' });
  try { res.json(await fn(dep, req)); }
  catch (e) { res.status(502).json({ error: e.message }); }
};

app.post('/api/deployments/:id/advice', requireAuth(), withDep((dep) => advise(dep)));
app.post('/api/deployments/:id/explain', requireAuth(), withDep(async (dep) => ({ explanation: await explainError(dep) })));
app.post('/api/deployments/:id/apply', requireAuth('admin'), withDep(async (dep, req) => { await applyAction(dep, req.body); return getDep(dep.id); }));

app.use((err, _req, res, _next) => { // malformed JSON etc.
  res.status(400).json({ error: 'Invalid request.' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on :${port} (orchestrator=${orchestrator()}, target=${target()}, dry_run=${process.env.DRY_RUN === '1'})`));

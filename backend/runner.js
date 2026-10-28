import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'workspace'));
const IS_WINDOWS = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ORCHESTRATOR: who runs the pipeline.  local = scripts on this machine (through WSL on Windows) | jenkins
// TARGET: where apps run.               microk8s = this machine (free)                            | aws = one EC2 server
// The old MODE variable still works: MODE=jenkins -> ORCHESTRATOR=jenkins, MODE=aws -> TARGET=aws.
export const orchestrator = () => process.env.ORCHESTRATOR || (process.env.MODE === 'jenkins' ? 'jenkins' : 'local');
export const target = () => process.env.TARGET || (process.env.MODE === 'aws' ? 'aws' : 'microk8s');

const STAGES = { provision: 'provisioning', configure: 'configuring', build: 'building', deploy: 'deploying' };

// Turns raw output into stored logs + status updates.
function makeSink(id) {
  let buffer = '';
  return (chunk) => {
    const text = chunk.toString();
    db.prepare('UPDATE deployments SET logs = logs || ? WHERE id = ?').run(text, id);
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const stage = line.match(/^### STAGE: (\w+)/)?.[1];
      if (stage && STAGES[stage]) {
        db.prepare('UPDATE deployments SET status = ?, stage = ? WHERE id = ?').run(STAGES[stage], STAGES[stage], id);
      }
      const url = line.match(/^APP_URL=(\S+)/)?.[1];
      if (url) db.prepare('UPDATE deployments SET app_url = ? WHERE id = ?').run(url, id);
    }
  };
}

// ---- Running bash: inside WSL on Windows, directly on Linux/macOS ----

// D:\project\autodeployers  ->  /mnt/d/project/autodeployers
function windowsPathToWsl(p) {
  const m = path.resolve(p).replace(/\\/g, '/').match(/^([A-Za-z]):\/(.*)$/);
  if (!m) throw new Error(`Cannot convert Windows path to WSL path: ${p}`);
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`;
}
const toShellPath = (p) => (IS_WINDOWS ? windowsPathToWsl(p) : p);
const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

// Runs `command` in bash with `vars` exported. Resolves {code, stdout, stderr}.
function bash(vars, command, { onOutput, timeout } = {}) {
  const exports = Object.entries(vars)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join('; ');
  const full = `${exports}; ${command}`;
  const [file, args] = IS_WINDOWS ? ['wsl.exe', ['bash', '-c', full]] : ['bash', ['-c', full]];
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    const child = spawn(file, args, { windowsHide: true });
    const timer = timeout && setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => { stdout += d; onOutput?.(d); });
    child.stderr.on('data', (d) => { stderr += d; onOutput?.(d); });
    child.on('error', (e) => { onOutput?.(`\nPROCESS ERROR: ${e.message}\n`); stderr += e.message; clearTimeout(timer); resolve({ code: 1, stdout, stderr }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

function envFor(dep) {
  return {
    PROJECT_NAME: dep.name, REPO_URL: dep.repo_url, ENVIRONMENT: dep.environment,
    REPLICAS: String(dep.replicas), APP_PORT: String(dep.app_port), NODE_PORT: String(dep.node_port),
  };
}

// Everything the shell scripts need. Empty values are skipped.
function pipelineVars(dep) {
  const p = process.env;
  return {
    ...envFor(dep),
    DATA_DIR: toShellPath(DATA_DIR),
    TARGET: target(),
    DOCKER_USER: p.DOCKER_USER, DOCKER_TOKEN: p.DOCKER_TOKEN,
    MICROK8S_BIN: p.MICROK8S_BIN,
    SSH_KEY_PATH: p.SSH_KEY_PATH, INSTANCE_TYPE: p.INSTANCE_TYPE || 't3.micro',
    AWS_ACCESS_KEY_ID: p.AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: p.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: p.AWS_SESSION_TOKEN, AWS_DEFAULT_REGION: p.AWS_DEFAULT_REGION,
  };
}

// orchestrator=local: run the four scripts one after another.
async function runLocal(dep, sink) {
  for (const step of ['provision', 'configure', 'build', 'deploy']) {
    if (process.env.DRY_RUN === '1') {              // simulation: no shell, no WSL needed
      sink(`### STAGE: ${step}\n[dry-run] ${step} completed (target=${target()}).\n`);
      if (step === 'deploy') sink(`APP_URL=http://localhost:${dep.node_port}\n`);
      await sleep(700);
      continue;
    }
    const { code } = await bash(pipelineVars(dep),
      `cd ${shellQuote(toShellPath(ROOT))} && bash ${shellQuote(`scripts/${step}.sh`)}`, { onOutput: sink });
    if (code !== 0) throw new Error(`Step "${step}" failed with exit code ${code}`);
  }
}

// orchestrator=jenkins: trigger the job, wait for it to start, then stream its console output.
async function runJenkins(dep, sink) {
  const { JENKINS_URL, JENKINS_USER, JENKINS_TOKEN, JENKINS_JOB = 'autodeployers' } = process.env;
  const headers = { Authorization: 'Basic ' + Buffer.from(`${JENKINS_USER}:${JENKINS_TOKEN}`).toString('base64') };
  const body = new URLSearchParams({ ...envFor(dep), TARGET: target() });
  const res = await fetch(`${JENKINS_URL}/job/${JENKINS_JOB}/buildWithParameters`, { method: 'POST', headers, body });
  if (res.status !== 201) throw new Error(`Jenkins refused the build (HTTP ${res.status})`);
  const queueUrl = res.headers.get('location');

  let buildUrl;
  while (!buildUrl) {
    await sleep(2000);
    const q = await (await fetch(`${queueUrl}api/json`, { headers })).json();
    if (q.cancelled) throw new Error('Jenkins build was cancelled');
    buildUrl = q.executable?.url;
  }
  let offset = 0;
  for (;;) {
    const r = await fetch(`${buildUrl}logText/progressiveText?start=${offset}`, { headers });
    sink(await r.text());
    offset = Number(r.headers.get('x-text-size') || offset);
    if (r.headers.get('x-more-data') !== 'true') break;
    await sleep(2000);
  }
  const info = await (await fetch(`${buildUrl}api/json`, { headers })).json();
  if (info.result !== 'SUCCESS') throw new Error(`Jenkins build finished with result ${info.result}`);
}

async function run(id) {
  const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
  const sink = makeSink(id);
  try {
    await (orchestrator() === 'jenkins' ? runJenkins(dep, sink) : runLocal(dep, sink));
    db.prepare("UPDATE deployments SET status='deployed', finished_at=datetime('now') WHERE id=?").run(id);
  } catch (err) {
    sink(`\nERROR: ${err.message}\n`);
    db.prepare("UPDATE deployments SET status='failed', finished_at=datetime('now') WHERE id=?").run(id);
  }
}

// Deployments run one at a time: they share one cluster, so two at once would fight over it.
let queue = Promise.resolve();
export function startDeployment(id) {
  queue = queue.then(() => run(id));
  return queue;
}

// ---- Kubernetes helpers (AI "apply" actions). They go through the same bash/WSL path as the pipeline,
// ---- so kubectl does not have to be installed on Windows.
async function kubectl(args) {
  const q = args.map(shellQuote).join(' ');
  const cmd = target() === 'microk8s'
    ? `"\${MICROK8S_BIN:-/snap/bin/microk8s}" kubectl ${q}`
    : `kubectl --kubeconfig "$DATA_DIR/_platform/kubeconfig" ${q}`;
  const { code, stdout, stderr } = await bash({ DATA_DIR: toShellPath(DATA_DIR), MICROK8S_BIN: process.env.MICROK8S_BIN }, cmd, { timeout: 30000 });
  if (code !== 0) throw new Error(stderr.trim() || `kubectl failed (exit ${code})`);
  return stdout;
}

export async function liveState(dep) {
  if (process.env.DRY_RUN === '1') {
    return { replicas: dep.replicas, pods: [{ name: `${dep.name}-demo`, cpu: '3m', memory: '38Mi' }], note: 'simulated' };
  }
  const base = ['-n', dep.environment];
  const deploy = JSON.parse(await kubectl(['get', 'deploy', dep.name, '-o', 'json', ...base]));
  // `top` needs the metrics-server addon (microk8s enable metrics-server); without it we just skip usage numbers.
  const top = await kubectl(['top', 'pods', '-l', `app=${dep.name}`, '--no-headers', ...base]).catch(() => '');
  return {
    replicas: deploy.spec.replicas,
    ready: deploy.status.readyReplicas ?? 0,
    resources: deploy.spec.template.spec.containers[0].resources,
    pods: top.trim().split('\n').filter(Boolean).map((l) => { const [name, cpu, memory] = l.split(/\s+/); return { name, cpu, memory }; }),
  };
}

// Whitelist: the only thing the "agent" is allowed to do is change the replica count.
export async function applyAction(dep, action) {
  if (action?.type !== 'scale' || !Number.isInteger(action.replicas) || action.replicas < 0 || action.replicas > 5) {
    throw new Error('Unsupported action. Only "scale" with 0-5 replicas is allowed.');
  }
  if (process.env.DRY_RUN !== '1') {
    await kubectl(['scale', `deploy/${dep.name}`, `--replicas=${action.replicas}`, '-n', dep.environment]);
  }
  db.prepare('UPDATE deployments SET replicas = ? WHERE id = ?').run(action.replicas, dep.id);
  db.prepare('INSERT INTO actions (deployment_id, type, detail) VALUES (?, ?, ?)')
    .run(dep.id, 'scale', `replicas ${dep.replicas} -> ${action.replicas}`);
}

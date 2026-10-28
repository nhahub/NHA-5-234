import { useEffect, useRef, useState } from 'react';
import { api, setToken } from './api.js';

const PIPELINE = [
  { key: 'provisioning', label: 'Create server' },
  { key: 'configuring', label: 'Configure server' },
  { key: 'building', label: 'Build image' },
  { key: 'deploying', label: 'Deploy to Kubernetes' },
];
const ACTIVE = ['queued', 'provisioning', 'configuring', 'building', 'deploying'];
const STATUS_TEXT = { queued: 'Queued', provisioning: 'Creating server', configuring: 'Configuring', building: 'Building image',
  deploying: 'Deploying', deployed: 'Live', failed: 'Failed' };
const SESSION_KEY = 'autodeployers_session';

function stepState(dep, index) {
  if (dep.status === 'deployed') return 'done';
  const current = PIPELINE.findIndex((s) => s.key === dep.stage);
  if (current === -1) return 'waiting';
  if (index < current) return 'done';
  if (index === current) return dep.status === 'failed' ? 'failed' : 'active';
  return 'waiting';
}

function Status({ status }) {
  return <span className={`status status-${status}`}>{STATUS_TEXT[status] || status}</span>;
}

// ---------------- Auth ----------------

function useSession() {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
  });
  useEffect(() => { setToken(session?.token || null); }, [session]);
  const login = (s) => { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); setSession(s); };
  const logout = () => { localStorage.removeItem(SESSION_KEY); setSession(null); };
  return { session, login, logout };
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try { onLogin(await api.login(username, password)); }
    catch (err) { setError(err.message); }
    setBusy(false);
  }

  return (
    <div className="login-screen">
      <form className="panel form login-form" onSubmit={submit}>
        <h1>AutoDeployers</h1>
        <p className="hint">Sign in to deploy and manage apps.</p>
        <label>Username<input required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Password<input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

// ---------------- Deploy form (admin only) ----------------

function DeployForm({ templates, onCreated }) {
  const [form, setForm] = useState({ name: '', repoUrl: '', environment: 'dev', replicas: 1, appPort: 3000, template: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function applyTemplate(id) {
    const t = templates.find((t) => t.id === id);
    setForm((f) => ({ ...f, template: id, appPort: t ? t.defaultPort : f.appPort, replicas: t ? t.defaultReplicas : f.replicas }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const dep = await api.create({ ...form, replicas: Number(form.replicas), appPort: Number(form.appPort), template: form.template || null });
      setForm({ ...form, name: '', repoUrl: '' });
      onCreated(dep);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  const selected = templates.find((t) => t.id === form.template);

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>New deployment</h2>
      <label>Template
        <select value={form.template} onChange={(e) => applyTemplate(e.target.value)}>
          <option value="">Custom (no template)</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {selected && <p className="hint">{selected.description}</p>}
      <label>Project name<input required value={form.name} onChange={set('name')} placeholder="my-shop-api" /></label>
      <label>Repository URL<input required value={form.repoUrl} onChange={set('repoUrl')} placeholder={selected?.sampleRepoUrl || 'https://github.com/user/repo'} /></label>
      <p className="hint">The repository needs a Dockerfile at its root.</p>
      <div className="row">
        <label>Environment
          <select value={form.environment} onChange={set('environment')}>
            <option value="dev">dev</option><option value="staging">staging</option><option value="prod">prod</option>
          </select>
        </label>
        <label>Replicas<input type="number" min="1" max="5" value={form.replicas} onChange={set('replicas')} /></label>
        <label>App port<input type="number" min="1" max="65535" value={form.appPort} onChange={set('appPort')} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Starting…' : 'Deploy'}</button>
    </form>
  );
}

// ---------------- Pipeline / logs / AI (shared with detail view) ----------------

function Pipeline({ dep }) {
  return (
    <ol className="pipeline" aria-label="Deployment progress">
      {PIPELINE.map((s, i) => (
        <li key={s.key} className={`step step-${stepState(dep, i)}`}>
          <span className="dot" />
          <span className="step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function LogView({ logs }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  return <pre className="logs" ref={ref} tabIndex={0}>{logs || 'Waiting for output…'}</pre>;
}

function ActionHistory({ id }) {
  const [actions, setActions] = useState(null);
  useEffect(() => { api.actions(id).then(setActions).catch(() => setActions([])); }, [id]);
  if (!actions || actions.length === 0) return null;
  return (
    <section className="panel">
      <h3>Action history</h3>
      <ul className="action-history">
        {actions.map((a, i) => <li key={i}><span>{a.detail}</span><time>{a.created_at}</time></li>)}
      </ul>
    </section>
  );
}

function AiPanel({ dep, isAdmin, onChanged }) {
  const [advice, setAdvice] = useState(null);
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function run(kind, fn) {
    setError(''); setBusy(kind);
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy('');
  }
  const getAdvice = () => run('advice', async () => setAdvice(await api.advice(dep.id)));
  const explain = () => run('explain', async () => setExplanation((await api.explain(dep.id)).explanation));
  const apply = (action) => run('apply', async () => {
    await api.apply(dep.id, action);
    setAdvice({ ...advice, actions: advice.actions.filter((a) => a !== action) });
    onChanged();
  });

  return (
    <section className="panel ai">
      <h3>AI assistant</h3>
      <div className="row buttons">
        <button onClick={getAdvice} disabled={!!busy || dep.status !== 'deployed'}>{busy === 'advice' ? 'Analyzing…' : 'Suggest cost savings'}</button>
        {dep.status === 'failed' && <button onClick={explain} disabled={!!busy}>{busy === 'explain' ? 'Reading logs…' : 'Explain this failure'}</button>}
      </div>
      {dep.status !== 'deployed' && dep.status !== 'failed' && <p className="hint">Cost advice is available once the app is live.</p>}
      {!isAdmin && <p className="hint">Sign in as an admin to apply suggested changes.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {explanation && <p className="ai-text">{explanation}</p>}
      {advice && (
        <div>
          <p className="ai-text">{advice.summary}</p>
          {advice.actions.map((a, i) => (
            <div className="action" key={i}>
              <span>Set replicas to <strong>{a.replicas}</strong><br /><small>{a.reason}</small></span>
              {isAdmin && <button className="primary" onClick={() => apply(a)} disabled={!!busy}>Apply</button>}
            </div>
          ))}
          {advice.actions.length === 0 && <p className="hint">No changes suggested.</p>}
        </div>
      )}
    </section>
  );
}

function Detail({ id, isAdmin, onChanged }) {
  const [dep, setDep] = useState(null);
  const load = () => api.get(id).then(setDep).catch(() => {});
  useEffect(() => { setDep(null); load(); }, [id]);
  useEffect(() => {
    if (dep && !ACTIVE.includes(dep.status)) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [id, dep?.status]);

  if (!dep) return <div className="panel">Loading…</div>;
  return (
    <div className="detail">
      <header className="panel head">
        <div>
          <h2>{dep.name}</h2>
          <p className="meta">{dep.environment} · {dep.replicas} replica{dep.replicas > 1 ? 's' : ''} · {dep.repo_url.replace('https://', '')}
            {dep.template && <> · {dep.template}</>}</p>
        </div>
        <Status status={dep.status} />
      </header>
      <section className="panel">
        <Pipeline dep={dep} />
        {dep.app_url && <p className="live">Your app is running at <a href={dep.app_url} target="_blank" rel="noreferrer">{dep.app_url}</a></p>}
      </section>
      <section className="panel"><h3>Logs</h3><LogView logs={dep.logs} /></section>
      <ActionHistory id={dep.id} />
      <AiPanel dep={dep} isAdmin={isAdmin} onChanged={() => { load(); onChanged(); }} />
    </div>
  );
}

// ---------------- History tab: full searchable/filterable deployment log ----------------

function History({ onOpen }) {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ status: '', environment: '', q: '' });
  const load = () => {
    const active = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    api.list(active).then(setRows).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [filters]);

  return (
    <div className="panel history">
      <h2>Deployment history</h2>
      <div className="row filters">
        <input placeholder="Search by name…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Any status</option>
          {Object.keys(STATUS_TEXT).map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
        </select>
        <select value={filters.environment} onChange={(e) => setFilters({ ...filters, environment: e.target.value })}>
          <option value="">Any environment</option>
          <option value="dev">dev</option><option value="staging">staging</option><option value="prod">prod</option>
        </select>
      </div>
      {rows.length === 0 && <p className="hint">No deployments match these filters.</p>}
      {rows.length > 0 && (
        <table className="history-table">
          <thead><tr><th>Name</th><th>Environment</th><th>Status</th><th>Replicas</th><th>Started</th><th>Finished</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} onClick={() => onOpen(d.id)}>
                <td>{d.name}</td><td>{d.environment}</td><td><Status status={d.status} /></td>
                <td>{d.replicas}</td><td>{d.created_at}</td><td>{d.finished_at || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------- App shell ----------------

export default function App() {
  const { session, login, logout } = useSession();
  const [tab, setTab] = useState('deploy');
  const [list, setList] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);

  const refresh = () => api.list().then(setList).catch(() => {});
  useEffect(() => {
    if (!session) return;
    api.templates().then(setTemplates).catch(() => {});
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [session]);

  if (!session) return <Login onLogin={login} />;
  const isAdmin = session.role === 'admin';

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <div><h1>AutoDeployers</h1><p>Deploy a repository to Kubernetes without touching Terraform, Ansible or Jenkins.</p></div>
          <div className="session">
            <span>{session.username} · {session.role}</span>
            <button onClick={logout}>Sign out</button>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === 'deploy' ? 'active' : ''} onClick={() => setTab('deploy')}>Deploy</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
        </nav>
      </header>

      {tab === 'history' && <History onOpen={(id) => { setSelected(id); setTab('deploy'); }} />}

      {tab === 'deploy' && (
        <main className="layout">
          <aside>
            {isAdmin
              ? <DeployForm templates={templates} onCreated={(dep) => { setSelected(dep.id); refresh(); }} />
              : <p className="panel hint">Viewers can watch deployments and logs but can't start new ones. Ask an admin to deploy.</p>}
            <section className="panel">
              <h2>Deployments</h2>
              {list.length === 0 && <p className="hint">Nothing deployed yet.</p>}
              <ul className="list">
                {list.map((d) => (
                  <li key={d.id}>
                    <button className={`item ${selected === d.id ? 'selected' : ''}`} onClick={() => setSelected(d.id)}>
                      <span><strong>{d.name}</strong><br /><small>{d.environment}</small></span>
                      <Status status={d.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
          <section>{selected ? <Detail id={selected} isAdmin={isAdmin} onChanged={refresh} /> : <div className="panel empty">Select a deployment to see its progress and logs.</div>}</section>
        </main>
      )}
    </div>
  );
}

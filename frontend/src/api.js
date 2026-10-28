let token = null;
export const setToken = (t) => { token = t; };

async function req(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`/api${path}`, { headers, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  login: (username, password) => req('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  templates: () => req('/templates'),
  list: (filters = {}) => req(`/deployments?${new URLSearchParams(filters)}`),
  get: (id) => req(`/deployments/${id}`),
  actions: (id) => req(`/deployments/${id}/actions`),
  create: (body) => req('/deployments', { method: 'POST', body: JSON.stringify(body) }),
  advice: (id) => req(`/deployments/${id}/advice`, { method: 'POST' }),
  explain: (id) => req(`/deployments/${id}/explain`, { method: 'POST' }),
  apply: (id, action) => req(`/deployments/${id}/apply`, { method: 'POST', body: JSON.stringify(action) }),
};

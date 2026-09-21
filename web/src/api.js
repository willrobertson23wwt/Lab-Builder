const j = async (r) => {
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail || msg } catch {}
    throw new Error(msg)
  }
  return r.json()
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(j)

export const api = {
  catalog: () => fetch('/api/catalog').then(j),
  labs: () => fetch('/api/labs').then(j),
  lab: (slug) => fetch(`/api/labs/${slug}`).then(j),
  save: (slug, lab, layout) => fetch(`/api/labs/${slug}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lab, layout }) }).then(j),
  plan: (slug, power_on) => post(`/api/labs/${slug}/plan`, { power_on }),
  apply: (slug, confirm) => post(`/api/labs/${slug}/apply`, { confirm }),
  power: (slug, power_on) => post(`/api/labs/${slug}/power`, { power_on }),
  destroy: (slug, confirm) => post(`/api/labs/${slug}/destroy`, { confirm }),
  job: (id) => fetch(`/api/jobs/${id}`).then(j),
  output: (slug) => fetch(`/api/labs/${slug}/output`).then(j),
  vapps: () => fetch('/api/vapps').then(j),
  parseSetup: (body) => post('/api/rules/parse-setup', body),
  vappLab: (name) => fetch(`/api/vapps/${encodeURIComponent(name)}/lab`).then(j),
  vappPower: (name, power_on) => post(`/api/vapps/${encodeURIComponent(name)}/power`, { power_on }),
}

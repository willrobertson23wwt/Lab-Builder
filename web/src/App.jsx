import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, applyNodeChanges, applyEdgeChanges, useReactFlow } from '@xyflow/react'
import { api } from './api.js'
import { nodeTypes, edgeTypes, ICONS } from './nodes.jsx'
import { Inspector } from './Inspector.jsx'
import { labToGraph, graphToLab, layoutOf, defaultEdge, netId, vmId, iconFor, KINDS, kindInfo, wireGateway } from './convert.js'

const EMPTY_META = { vapp_name: '', description: '', org_network: '', edge_firewall: null, edge_nat: null } // org_network filled from /api/config

function Designer() {
  const rf = useReactFlow()
  const [catalog, setCatalog] = useState([])
  const [labs, setLabs] = useState([])
  const [vapps, setVapps] = useState([])
  const [source, setSource] = useState(null) // {type:'lab'} | {type:'vapp', name}
  const [slug, setSlug] = useState('')
  const [meta, setMeta] = useState(EMPTY_META)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selection, setSelection] = useState(null)
  const [multi, setMulti] = useState({ nodes: [], edges: [] })
  const [status, setStatus] = useState({})
  const [job, setJob] = useState(null)
  const [msg, setMsg] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [askConfirm, setAskConfirm] = useState(null) // 'apply' | 'destroy'
  const [setupModal, setSetupModal] = useState(null) // { text, path, result, error }
  const [consoleOpen, setConsoleOpen] = useState(true)
  const consoleRef = useRef(null)
  const canvasRef = useRef(null)
  const bandRef = useRef(null) // {x0,y0} in canvas pixels while right-dragging
  const [band, setBand] = useState(null) // {x, y, w, h} for the overlay

  const refreshLabs = useCallback(() => { api.labs().then(setLabs).catch(e => setMsg(e.message)); api.vapps().then(setVapps).catch(() => {}) }, [])
  useEffect(() => { fetch('/api/config').then(r => r.json()).then(c => { if (c.org_network) EMPTY_META.org_network = c.org_network }).catch(() => {}) }, [])
  useEffect(() => { api.catalog().then(setCatalog).catch(e => setMsg('catalog: ' + e.message)); refreshLabs() }, [refreshLabs])

  // poll the running job
  useEffect(() => {
    if (!job || job.status !== 'running') return
    const t = setInterval(() => api.job(job.id).then(j => {
      setJob(j)
      if (j.status !== 'running') { setMsg(`${j.kind} ${j.status}`); if (source?.type === 'vapp') api.vapps().then(vs => { setVapps(vs); const me = vs.find(x => x.name === source.name); if (me) setStatus(st => ({ ...st, vapp: me.status })) }); else loadStatus(slug) }
    }).catch(() => {}), 1500)
    return () => clearInterval(t)
  }, [job?.id, job?.status, slug, source])
  useEffect(() => { if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight }, [job?.output])

  const loadStatus = (s) => { if (s) api.lab(s).then(r => setStatus({ vapp: r.vapp_status, built: r.built, planned: r.planned })).catch(() => {}) }

  const loadLab = async (s) => {
    try {
      const r = await api.lab(s)
      const g = labToGraph(r.lab, r.layout)
      setSlug(s); setSource({ type: 'lab' }); setNodes(g.nodes); setEdges(g.edges); setSelection(null); setDirty(false)
      setMeta({ vapp_name: r.lab.vapp_name || '', description: r.lab.description || '', org_network: r.lab.org_network || EMPTY_META.org_network,
        edge_firewall: r.lab.edge_firewall || null, edge_nat: r.lab.edge_nat || null })
      setStatus({ vapp: r.vapp_status, built: r.built, planned: r.planned }); setJob(null); setMsg(`loaded ${s}`)
      setTimeout(() => rf.fitView({ padding: 0.2 }), 50)
    } catch (e) { setMsg(e.message) }
  }

  const loadVapp = async (name) => {
    try {
      setMsg(`reading ${name} from vCloud Director…`)
      const r = await api.vappLab(name)
      const g = labToGraph(r.lab, null)
      setSlug(name); setSource({ type: 'vapp', name }); setNodes(g.nodes); setEdges(g.edges); setSelection(null); setDirty(false)
      setMeta({ ...EMPTY_META, vapp_name: r.vapp_name }); setStatus({ vapp: r.vapp_status, built: true, live: true }); setJob(null)
      setMsg(`loaded live vApp ${name} (read-only)`)
      setTimeout(() => rf.fitView({ padding: 0.2 }), 50)
    } catch (e) { setMsg(e.message) }
  }
  const onPick = (v) => { if (!v) return; if (v.startsWith('lab:')) loadLab(v.slice(4)); else loadVapp(v.slice(5)) }

  const newLab = () => {
    const s = prompt('New lab slug (lowercase, dashes):', 'my-lab'); if (!s) return
    setSlug(s); setSource({ type: 'lab' }); setSelection(null); setDirty(true); setStatus({}); setJob(null)
    const gwTemplate = kindInfo('gateway').template
    const g = labToGraph({
      networks: { Gateway: { routed: true, cidr: '192.168.2.0/30', gateway: '192.168.2.1', pool: ['192.168.2.2', '192.168.2.2'] },
        Lab: { cidr: '192.168.10.0/24', gateway: '192.168.10.1' }, Management: { cidr: '10.0.0.0/24', gateway: '10.0.0.1' } },
      vms: { gateway: { kind: 'gateway', template: catalog.some(t => t.name === gwTemplate) ? gwTemplate : '', cpus: 2, memory: 4096,
        nics: [{ net: 'Gateway', mode: 'POOL' }, { net: 'Lab', mode: 'DHCP' }, { net: 'Management', mode: 'DHCP' }] } },
    })
    setNodes(g.nodes); setEdges(g.edges)
    setMeta({ ...EMPTY_META, vapp_name: `lab-${s}`, ...defaultEdge('gateway') })
    setMsg('new lab: gateway placed (Ubuntu server, NAT). Drag devices onto the canvas and link them to Lab.')
  }

  const vmNames = useMemo(() => nodes.filter(n => n.type === 'device').map(n => n.data.name), [nodes])
  const currentLab = useMemo(() => graphToLab(meta, nodes, edges), [meta, nodes, edges])

  const onNodesChange = useCallback(ch => { setNodes(ns => applyNodeChanges(ch, ns)); if (ch.some(c => c.type !== 'select' && c.type !== 'dimensions')) setDirty(true) }, [])
  const onEdgesChange = useCallback(ch => { setEdges(es => applyEdgeChanges(ch, es)); if (ch.some(c => c.type !== 'select')) setDirty(true) }, [])
  const onConnect = useCallback(params => {
    setEdges(es => {
      const src = params.source.startsWith('vm:') ? params.source : params.target
      const tgt = params.source.startsWith('vm:') ? params.target : params.source
      if (!src.startsWith('vm:') || !tgt.startsWith('net:')) return es
      const index = es.filter(e => e.source === src).length
      return addEdge({ id: `nic:${src.slice(3)}:${Date.now()}`, source: src, target: tgt, type: 'nic', data: { index, mode: 'DHCP', ip: '' } }, es)
    }); setDirty(true)
  }, [])

  const onSelectionChange = useCallback(({ nodes: sn, edges: se }) => {
    setMulti({ nodes: sn.map(n => n.id), edges: se.map(e => e.id) })
    if (sn.length + se.length > 1) setSelection({ kind: 'multi' })
    else if (sn.length) setSelection({ kind: 'node', id: sn[0].id }); else if (se.length) setSelection({ kind: 'edge', id: se[0].id }); else setSelection(null)
  }, [])
  const deleteMulti = () => {
    if (source?.type === 'vapp') return setMsg('live vApp view is read-only')
    rf.deleteElements({ nodes: multi.nodes.map(id => ({ id })), edges: multi.edges.map(id => ({ id })) })
    setSelection(null); setDirty(true)
  }
  const selected = useMemo(() => {
    if (!selection) return null
    if (selection.kind === 'multi') return { kind: 'multi', count: multi.nodes.length + multi.edges.length, nodes: multi.nodes.length, edges: multi.edges.length }
    const item = selection.kind === 'node' ? nodes.find(n => n.id === selection.id) : edges.find(e => e.id === selection.id)
    return item ? { ...selection, item } : null
  }, [selection, nodes, edges, multi])

  const changeNode = (id, patch) => {
    setDirty(true)
    setNodes(ns => ns.map(n => {
      if (n.id !== id) return n
      const data = { ...n.data, ...patch }
      // renaming changes the id so edges stay consistent
      if (patch.name && patch.name !== n.data.name) {
        const newId = n.type === 'device' ? vmId(patch.name) : netId(patch.name)
        setEdges(es => es.map(e => ({ ...e, source: e.source === id ? newId : e.source, target: e.target === id ? newId : e.target })))
        setSelection({ kind: 'node', id: newId })
        if (n.type === 'device' && meta.edge_nat?.vm === n.data.name) setMeta(m => ({ ...m, edge_nat: { ...m.edge_nat, vm: patch.name } }))
        return { ...n, id: newId, data }
      }
      return { ...n, data }
    }))
  }
  const changeEdge = (id, patch) => { setDirty(true); setEdges(es => es.map(e => e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)) }
  const deleteSelected = () => {
    if (!selected) return
    setDirty(true)
    if (selected.kind === 'node') { setNodes(ns => ns.filter(n => n.id !== selected.id)); setEdges(es => es.filter(e => e.source !== selected.id && e.target !== selected.id)) }
    else setEdges(es => es.filter(e => e.id !== selected.id))
    setSelection(null)
  }
  const changeMeta = (patch) => {
    setDirty(true)
    if (patch.__preset) { setMeta(m => ({ ...m, ...defaultEdge(m.edge_nat.vm) })); return }
    setMeta(m => ({ ...m, ...patch }))
  }

  // right-drag box selection (React Flow only box-selects with the left button)
  const canvasPoint = (ev) => { const r = canvasRef.current.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top } }
  const onCanvasPointerDown = (ev) => {
    if (ev.button !== 2 || !ev.target.closest('.react-flow__pane')) return
    ev.preventDefault()
    const p = canvasPoint(ev); bandRef.current = { x0: p.x, y0: p.y, cx: ev.clientX, cy: ev.clientY }
    setBand({ x: p.x, y: p.y, w: 0, h: 0 })
    const move = (e) => { const q = canvasPoint(e); const b = bandRef.current; setBand({ x: Math.min(b.x0, q.x), y: Math.min(b.y0, q.y), w: Math.abs(q.x - b.x0), h: Math.abs(q.y - b.y0) }) }
    const up = (e) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      const b = bandRef.current; bandRef.current = null; setBand(null)
      if (!b || (Math.abs(e.clientX - b.cx) < 4 && Math.abs(e.clientY - b.cy) < 4)) return
      const a = rf.screenToFlowPosition({ x: b.cx, y: b.cy }), z = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const rx0 = Math.min(a.x, z.x), ry0 = Math.min(a.y, z.y), rx1 = Math.max(a.x, z.x), ry1 = Math.max(a.y, z.y)
      const hit = new Set(rf.getNodes().filter(n => {
        const w = n.measured?.width ?? 150, h = n.measured?.height ?? 60
        return n.position.x < rx1 && n.position.x + w > rx0 && n.position.y < ry1 && n.position.y + h > ry0
      }).map(n => n.id))
      const additive = e.shiftKey
      setNodes(ns => ns.map(n => ({ ...n, selected: hit.has(n.id) || (additive && n.selected) })))
      setEdges(es => es.map(ed => ({ ...ed, selected: (hit.has(ed.source) && hit.has(ed.target)) || (additive && ed.selected) })))
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  // palette drag & drop
  const onDragStart = (ev, payload) => { ev.dataTransfer.setData('application/lab-item', JSON.stringify(payload)); ev.dataTransfer.effectAllowed = 'move' }
  const onDrop = useCallback(ev => {
    ev.preventDefault()
    const raw = ev.dataTransfer.getData('application/lab-item'); if (!raw) return
    if (source?.type === 'vapp') { setMsg('this is a live vApp (read-only). Click New to design a lab.'); return }
    if (!slug) { setMsg('click New first to start a lab'); return }
    const item = JSON.parse(raw)
    const position = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
    setDirty(true)
    setNodes(ns => {
      if (item.kind === 'network') {
        let i = 1; while (ns.some(n => n.id === netId(`Net${i}`))) i++
        return [...ns, { id: netId(`Net${i}`), type: 'network', position, data: { name: `Net${i}`, cidr: `192.168.${10 + i}.0/24`, gateway: `192.168.${10 + i}.1`, routed: false, pool: null, dns: '' } }]
      }
      const k = kindInfo(item.kind)
      const base = { gateway: 'gateway', server: 'server', desktop: 'desktop', winserver: 'winsrv', windesktop: 'win', router: 'router', firewall: 'fw', hypervisor: 'esx', other: 'vm' }[k.kind] || 'vm'
      let name = base
      if (k.kind !== 'gateway' || ns.some(n => n.id === vmId(base))) { let i = 1; while (ns.some(n => n.id === vmId(`${base}${i}`))) i++; name = `${base}${i}` }
      const template = catalog.some(t => t.name === k.template) ? k.template : ''
      const tvm = catalog.find(t => t.name === template)?.vms?.[0] || {}
      const node = { id: vmId(name), type: 'device', position, data: { name, kind: k.kind, template, cpus: Math.max(2, tvm.cpus || 2), memory: Math.max(4096, tvm.memory || 4096), disk_mb: null, computer_name: '', existing: false } }
      if (k.kind === 'gateway') {
        const wires = wireGateway(node.id, ns)
        setEdges(es => [...es, ...wires])
        setMeta(m => ({ ...m, edge_nat: { mode: 'ip_translation', vm: name }, ...(m.edge_firewall ? {} : { edge_firewall: defaultEdge(name).edge_firewall }) }))
        setMsg(wires.length ? `${name}: NIC0 on the uplink (192.168.2.2), NIC1 on the lab network; vApp edge NAT points at it` : `${name} placed; add a routed uplink and a lab network to auto-wire it`)
      }
      return [...ns, node]
    })
  }, [rf, catalog, source, slug])

  // actions
  const save = async () => {
    if (!slug) return setMsg('give the lab a slug first (New)')
    try { const r = await api.save(slug, currentLab, layoutOf(nodes)); setDirty(false); setStatus(s => ({ ...s, ...r })); setMsg(`saved labs/${slug}/lab.yaml`); refreshLabs() } catch (e) { setMsg('save failed: ' + e.message) }
  }
  const run = async (fn, label) => {
    try { const j = await fn(); setJob(j); setConsoleOpen(true); setMsg(`${label} started`) } catch (e) { setMsg(`${label}: ${e.message}`) }
  }
  const plan = async () => { if (dirty) await save(); run(() => api.plan(slug, false), 'plan') }
  const doConfirm = () => {
    if (confirmText !== slug) return setMsg('type the slug exactly to confirm')
    const kind = askConfirm; setAskConfirm(null); setConfirmText('')
    if (kind === 'apply') run(() => api.apply(slug, slug), 'apply')
    if (kind === 'destroy') run(() => api.destroy(slug, slug), 'destroy')
  }

  const running = job?.status === 'running'
  const planOk = job?.kind === 'plan' && job?.status === 'ok' && !dirty
  const planSummary = job?.kind === 'plan' && job?.output.match(/Plan: .*|No changes.*/)?.[0]

  return (
    <div className="app">
      <header>
        <div className="brand">Lab Designer</div>
        <button onClick={newLab}>New</button>
        <select value={source?.type === 'lab' ? `lab:${slug}` : source?.type === 'vapp' ? `vapp:${source.name}` : ''} onChange={e => onPick(e.target.value)}>
          <option value="">Load…</option>
          <optgroup label="Planned labs (this repo)">
            {labs.map(l => <option key={l.slug} value={`lab:${l.slug}`}>{l.slug}{l.built ? ' · built' : ''}</option>)}
          </optgroup>
          <optgroup label="vApps in vCloud Director">
            {vapps.filter(v => !labs.some(l => l.vapp_name === v.name && l.built)).map(v => <option key={v.name} value={`vapp:${v.name}`}>{v.name} · {(v.status || '').replace('POWERED_', '').toLowerCase()}</option>)}
          </optgroup>
        </select>
        <span className="slug">{source?.type === 'vapp' ? `vCD / ${source.name}` : slug ? `labs/${slug}` : 'no lab'}{dirty ? ' *' : ''}</span>
        <span className="spacer" />
        {slug && <span className={`chip ${status.vapp === 'POWERED_ON' ? 'on' : status.vapp === 'POWERED_OFF' ? 'off' : ''}`}>{status.vapp || '…'}</span>}
        {source?.type === 'vapp' ? (
          <button onClick={() => run(() => api.vappPower(source.name, status.vapp !== 'POWERED_ON'), 'power')} disabled={running}>{status.vapp === 'POWERED_ON' ? 'Power off' : 'Power on'}</button>
        ) : (<>
          <button onClick={save} disabled={!slug || running}>Save</button>
          <button onClick={plan} disabled={!slug || running}>Plan</button>
          <button className="primary" onClick={() => setAskConfirm('apply')} disabled={!planOk || running} title={planOk ? 'apply the reviewed plan' : 'run Plan first (and save)'}>Apply…</button>
          {status.built && <button onClick={() => run(() => api.power(slug, status.vapp !== 'POWERED_ON'), 'power')} disabled={running}>{status.vapp === 'POWERED_ON' ? 'Power off' : 'Power on'}</button>}
          {status.built && <button className="danger" onClick={() => setAskConfirm('destroy')} disabled={running}>Destroy…</button>}
        </>)}
      </header>

      <div className="body">
        <aside className="palette">
          <h3>Devices</h3>
          <div className="hint">drag onto the canvas, then pick the golden image</div>
          <div className="pal-grid">
            {KINDS.map(k => (
              <div key={k.kind} className="pal-tile" draggable onDragStart={e => onDragStart(e, { kind: k.kind })} title={k.template ? `default image: ${k.template}` : 'pick an image after dropping'}>
                <div className="tile-icon">{ICONS[k.kind === 'windesktop' ? 'desktop' : k.kind] || ICONS.server}</div>
                <div className="tile-label">{k.label}</div>
              </div>
            ))}
          </div>
          <h3>Networks</h3>
          <div className="pal-grid">
            <div className="pal-tile net" draggable onDragStart={e => onDragStart(e, { kind: 'network' })} title="an isolated L2 segment inside the vApp">
              <div className="tile-icon"><svg viewBox="0 0 48 48" width="40" height="40"><path d="M6 24h36" stroke="#60a5fa" strokeWidth="3"/>{[10, 24, 38].map(x => <circle key={x} cx={x} cy="24" r="4" fill="#60a5fa" stroke="#0f172a" strokeWidth="2"/>)}</svg></div>
              <div className="tile-label">Network segment</div>
            </div>
          </div>
          <div className="hint">{catalog.length} golden images loaded from atc-gold-masters</div>
        </aside>

        <main className="canvas" ref={canvasRef} onDrop={onDrop} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
          onPointerDown={onCanvasPointerDown} onContextMenu={e => e.preventDefault()}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onSelectionChange={onSelectionChange} fitView deleteKeyCode={['Backspace', 'Delete']} connectionRadius={40} minZoom={0.3} colorMode="dark">
            <Background variant="lines" gap={28} color="#334a66" />
            <Controls />
            <MiniMap pannable zoomable style={{ width: 140, height: 90 }} nodeColor={n => n.type === "network" ? "#93c5fd" : "#cbd5e1"} />
          </ReactFlow>
          {band && <div className="band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
          {!slug && <div className="empty"><span>Choose <b>Load…</b> to open a planned lab or a live vApp, or click <b>New</b> to start drawing.<br/><small>Left-drag pans · right-drag draws a selection box (Shift adds) · wheel zooms · Delete removes the selection</small></span></div>}
        </main>

        <Inspector selection={selected} nodes={nodes} catalog={catalog} onChangeNode={changeNode} onChangeEdge={changeEdge} onDelete={deleteSelected}
          meta={meta} onChangeMeta={changeMeta} vmNames={vmNames} readOnly={source?.type === 'vapp'} onDeleteMulti={deleteMulti}
          onOpenSetup={() => setSetupModal({ text: '', path: '', result: null, error: '' })} />
      </div>

      <footer>
        <div className="statusbar">
          <span>{msg}</span>
          {planSummary && <span className="plan-summary">{planSummary}</span>}
          {job && <span className={`chip job ${job.status}`}>{job.kind} · {job.status}</span>}
          <span className="spacer" />
          <button className="small" onClick={() => setConsoleOpen(o => !o)}>{consoleOpen ? 'hide output' : 'show output'}</button>
        </div>
        {consoleOpen && <pre className="console" ref={consoleRef}>{job?.output || 'Terraform output appears here after Plan.'}</pre>}
      </footer>

      {setupModal && (
        <div className="modal-back" onClick={() => setSetupModal(null)}>
          <div className="modal wide" onClick={e => e.stopPropagation()}>
            <h3>Firewall rules from SETUP.md</h3>
            <p>Paste the <b>vApp edge firewall</b> table (or the whole SETUP.md) written by the <code>/lab</code> skill, or give a path on this machine. Rules that name the gateway or lab VM are pinned to <b>{meta.edge_nat?.vm || 'gateway'}</b>.</p>
            <input className="mono" placeholder="/path/to/lab-repo/SETUP.md (optional)" value={setupModal.path} onChange={e => setSetupModal(m => ({ ...m, path: e.target.value }))} />
            <textarea className="mono" rows={7} placeholder={'| # | Name | Action | Protocol | Source | Destination | Ports |\n|---|---|---|---|---|---|---|\n| 1 | Allow portal SSH in | Allow | TCP | external : Any | internal : gateway VM only | 22, 2210, 2211 |'} value={setupModal.text} onChange={e => setSetupModal(m => ({ ...m, text: e.target.value }))} />
            <div className="modal-actions">
              <button onClick={async () => {
                try { const r = await api.parseSetup({ text: setupModal.text, path: setupModal.path || null, gateway: meta.edge_nat?.vm || 'gateway', vm_names: vmNames }); setSetupModal(m => ({ ...m, result: r, error: '' })) }
                catch (e) { setSetupModal(m => ({ ...m, error: e.message, result: null })) }
              }}>Parse</button>
              <span className="spacer" />
              <button onClick={() => setSetupModal(null)}>Cancel</button>
              <button className="primary" disabled={!setupModal.result?.rules?.length} onClick={() => { const { notes, ...fw } = setupModal.result; changeMeta({ edge_firewall: fw }); setSetupModal(null); setMsg(`${fw.rules.length} firewall rules loaded from SETUP.md`) }}>Use these rules</button>
            </div>
            {setupModal.error && <div className="hint warn">{setupModal.error}</div>}
            {setupModal.result && (
              <div className="parse-result">
                <div className="hint">default {setupModal.result.default_action}{setupModal.result.log_default_action ? ', logged' : ''} · {setupModal.result.rules.length} rules</div>
                {setupModal.result.rules.map((r, i) => <div key={i} className={`rule ${r.enabled === false ? 'off' : ''}`}><b>{r.policy}</b> {r.protocol} {r.source_ip || 'any'} → {r.destination_vm ? `VM ${r.destination_vm} (NAT)` : r.destination_ip}:{r.destination_port || 'any'}<span className="rule-name">{r.name}</span></div>)}
                {setupModal.result.notes.map((n, i) => <div key={i} className="hint">{n}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
      {askConfirm && (
        <div className="modal-back" onClick={() => setAskConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{askConfirm === 'apply' ? 'Build this lab in vCloud Director?' : 'Destroy this vApp?'}</h3>
            {askConfirm === 'apply'
              ? <p>Applies exactly the plan shown below ({planSummary || 'see console'}) as vApp <b>{meta.vapp_name}</b>. VMs are created powered off.</p>
              : <p>Deletes vApp <b>{meta.vapp_name}</b> and every VM in it. This cannot be undone.</p>}
            <p>Type <code>{slug}</code> to confirm.</p>
            <input autoFocus value={confirmText} onChange={e => setConfirmText(e.target.value)} onKeyDown={e => e.key === 'Enter' && doConfirm()} />
            <div className="modal-actions">
              <button onClick={() => setAskConfirm(null)}>Cancel</button>
              <button className={askConfirm === 'apply' ? 'primary' : 'danger'} onClick={doConfirm} disabled={confirmText !== slug}>{askConfirm === 'apply' ? 'Build' : 'Destroy'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return <ReactFlowProvider><Designer /></ReactFlowProvider>
}

import React, { useState } from 'react'
import { KINDS, kindInfo, emptyRule } from './convert.js'

const Field = ({ label, children }) => (
  <label className="field"><span>{label}</span>{children}</label>
)

function DevicePanel({ n, d, catalog, onChangeNode, onDelete, readOnly }) {
  const [showAll, setShowAll] = useState(false)
  const info = kindInfo(d.kind)
  const fits = catalog.filter(t => showAll || info.match.test(t.name) || t.name === d.template)
  const tvm = catalog.find(t => t.name === d.template)?.vms?.[0]
  if (d.existing) {
    return (
      <div className="inspector">
        <h3>Existing VM</h3>
        <div className="kv"><span>Name</span><b>{d.name}</b></div>
        <div className="kv"><span>Guest OS</span><b>{d.os || '?'}</b></div>
        <div className="kv"><span>Sizing</span><b>{d.cpus} vCPU · {d.memory} MB</b></div>
        <div className="kv"><span>Status</span><b>{d.status}</b></div>
        <p className="hint">This VM already exists in vCloud Director. The canvas shows it read-only; use Power on / off in the toolbar.</p>
      </div>
    )
  }
  return (
    <div className="inspector">
      <h3>Device</h3>
      <Field label="Name (VM and hostname)"><input value={d.name} onChange={e => onChangeNode(n.id, { name: e.target.value.replace(/[^A-Za-z0-9-]/g, '') })} /></Field>
      <Field label="Device type">
        <select value={d.kind} onChange={e => { const k = kindInfo(e.target.value); onChangeNode(n.id, { kind: k.kind, template: catalog.some(t => t.name === k.template) ? k.template : '' }) }}>
          {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      </Field>
      <Field label={<span>Golden image <label className="inline"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> show all</label></span>}>
        <select value={d.template} onChange={e => onChangeNode(n.id, { template: e.target.value })}>
          <option value="">choose…</option>
          {fits.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
      </Field>
      {tvm && <div className="hint">Template VM: {tvm.os}. Template default {tvm.cpus} vCPU / {tvm.memory} MB. <button className="link" onClick={() => onChangeNode(n.id, { cpus: tvm.cpus, memory: tvm.memory })}>use defaults</button></div>}
      {!d.template && <div className="hint warn">No image chosen. {fits.length === 0 && !showAll ? 'No gold master matches this type; tick "show all".' : ''}</div>}
      <div className="row">
        <Field label="vCPU"><input type="number" min="1" value={d.cpus} onChange={e => onChangeNode(n.id, { cpus: Number(e.target.value) })} /></Field>
        <Field label="Memory MB"><input type="number" step="1024" min="512" value={d.memory} onChange={e => onChangeNode(n.id, { memory: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Disk MB (blank = template)"><input type="number" step="1024" value={d.disk_mb ?? ''} onChange={e => onChangeNode(n.id, { disk_mb: e.target.value ? Number(e.target.value) : null })} /></Field>
      <button className="danger" onClick={() => onDelete()}>Remove device</button>
    </div>
  )
}

const ZONES = ['any', 'internal', 'external']

function EndpointPicker({ rule, side, vmNames, onChange }) {
  // side = 'source' | 'destination'. Value is a zone keyword, a VM name, or a literal ip/range.
  const vmKey = `${side}_vm`, ipKey = `${side}_ip`
  const current = rule[vmKey] ? `vm:${rule[vmKey]}` : ZONES.includes(rule[ipKey] || 'any') ? (rule[ipKey] || 'any') : 'ip'
  const set = (v) => {
    const patch = { [vmKey]: undefined, [`${side}_vm_ip_type`]: undefined, [ipKey]: undefined }
    if (v.startsWith('vm:')) { patch[vmKey] = v.slice(3); patch[`${side}_vm_ip_type`] = side === 'destination' ? 'NAT' : 'assigned' }
    else if (v === 'ip') patch[ipKey] = rule[ipKey] && !ZONES.includes(rule[ipKey]) ? rule[ipKey] : '10.0.0.0/24'
    else patch[ipKey] = v
    onChange(patch)
  }
  return (
    <span className="ep">
      <select value={current} onChange={e => set(e.target.value)}>
        {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
        {vmNames.map(n => <option key={n} value={`vm:${n}`}>VM {n}{side === 'destination' ? ' (NAT addr)' : ''}</option>)}
        <option value="ip">ip / range…</option>
      </select>
      {current === 'ip' && <input className="mono" value={rule[ipKey] || ''} onChange={e => onChange({ [ipKey]: e.target.value })} placeholder="10.0.0.0/24" />}
    </span>
  )
}

function FirewallSection({ meta, onChangeMeta, vmNames, readOnly, onOpenSetup }) {
  const [editing, setEditing] = useState(false)
  const fw = meta.edge_firewall
  const rules = fw?.rules || []
  const setRules = (next) => onChangeMeta({ edge_firewall: { ...(fw || { default_action: 'drop', log_default_action: false }), rules: next } })
  const patchRule = (i, patch) => setRules(rules.map((r, k) => {
    if (k !== i) return r
    const n = { ...r, ...patch }; Object.keys(n).forEach(key => n[key] === undefined && delete n[key]); return n
  }))
  return (
    <div className="rules">
      <div className="rules-head">
        <span>Firewall rules ({rules.length}){fw ? ` · default ${fw.default_action}${fw.log_default_action ? ', logged' : ''}` : ''}</span>
      </div>
      {!readOnly && (
        <div className="fw-modes">
          <button className="small" disabled={!meta.edge_nat?.vm} title="Copy of the reference vApp: allow all in, allow all out, default drop" onClick={() => onChangeMeta({ __preset: true })}>House preset</button>
          <button className="small" title="Parse the vApp edge firewall table from a lab's SETUP.md" onClick={onOpenSetup}>From SETUP.md…</button>
          <button className={`small ${editing ? 'active' : ''}`} title="Edit rules by hand" onClick={() => { if (!fw) setRules([]); setEditing(e => !e) }}>{editing ? 'Done editing' : 'Custom…'}</button>
        </div>
      )}
      {editing && fw && (
        <div className="fw-defaults">
          <label>default <select value={fw.default_action} onChange={e => onChangeMeta({ edge_firewall: { ...fw, default_action: e.target.value } })}><option value="drop">drop</option><option value="allow">allow</option></select></label>
          <label><input type="checkbox" checked={!!fw.log_default_action} onChange={e => onChangeMeta({ edge_firewall: { ...fw, log_default_action: e.target.checked } })} /> log default</label>
        </div>
      )}
      {rules.map((r, i) => editing ? (
        <div key={i} className={`rule edit ${r.enabled === false ? 'off' : ''}`}>
          <div className="rule-row">
            <input className="rule-name" value={r.name || ''} onChange={e => patchRule(i, { name: e.target.value })} />
            <select value={r.policy || 'allow'} onChange={e => patchRule(i, { policy: e.target.value })}><option>allow</option><option>drop</option></select>
            <select value={r.protocol || 'any'} onChange={e => patchRule(i, { protocol: e.target.value })}>{['any', 'tcp', 'udp', 'icmp'].map(p => <option key={p}>{p}</option>)}</select>
          </div>
          <div className="rule-row"><span className="lbl">from</span><EndpointPicker rule={r} side="source" vmNames={vmNames} onChange={p => patchRule(i, p)} /></div>
          <div className="rule-row"><span className="lbl">to</span><EndpointPicker rule={r} side="destination" vmNames={vmNames} onChange={p => patchRule(i, p)} />
            <input className="mono port" value={r.destination_port || 'any'} onChange={e => patchRule(i, { destination_port: e.target.value })} title="port or range, e.g. 22 or 2210-2211" /></div>
          <div className="rule-row">
            <label><input type="checkbox" checked={r.enabled !== false} onChange={e => patchRule(i, { enabled: e.target.checked ? undefined : false })} /> enabled</label>
            <span className="spacer" />
            <button className="small" disabled={i === 0} onClick={() => { const n = [...rules]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setRules(n) }}>↑</button>
            <button className="small" disabled={i === rules.length - 1} onClick={() => { const n = [...rules]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setRules(n) }}>↓</button>
            <button className="small danger" onClick={() => setRules(rules.filter((_, k) => k !== i))}>remove</button>
          </div>
        </div>
      ) : (
        <div key={i} className={`rule ${r.enabled === false ? 'off' : ''}`}>
          <b>{r.policy || 'allow'}</b> {r.protocol || 'any'} {r.source_vm ? `VM ${r.source_vm}` : (r.source_ip || 'any')} → {r.destination_vm ? `VM ${r.destination_vm} (${r.destination_vm_ip_type || 'NAT'})` : (r.destination_ip || 'any')}:{r.destination_port || 'any'}
          <span className="rule-name">{r.name}{r.enabled === false ? ' · disabled' : ''}</span>
        </div>
      ))}
      {editing && <button className="small" onClick={() => setRules([...rules, emptyRule()])}>+ add rule</button>}
      {!fw && <div className="hint">No edge firewall: the vApp edge passes everything. Pick a mode above.</div>}
    </div>
  )
}

export function Inspector({ selection, nodes, catalog, onChangeNode, onChangeEdge, onDelete, meta, onChangeMeta, vmNames, readOnly, onDeleteMulti, onOpenSetup }) {
  if (selection?.kind === 'multi') {
    return (
      <div className="inspector">
        <h3>Selection</h3>
        <p className="hint">{selection.nodes} device{selection.nodes === 1 ? '' : 's'}/network{selection.nodes === 1 ? '' : 's'} and {selection.edges} NIC link{selection.edges === 1 ? '' : 's'} selected. Drag any selected item to move them together, or press Delete. Right-drag with Shift to add to the selection.</p>
        <button className="danger" onClick={onDeleteMulti} disabled={readOnly}>Delete {selection.count} items</button>
      </div>
    )
  }
  if (!selection) {
    return (
      <div className="inspector">
        <h3>{readOnly ? 'vApp (live, read-only)' : 'Lab'}</h3>
        {readOnly && <p className="hint">Loaded from vCloud Director. Drawing changes are not saved back; use Power on / off, or design a new lab with New.</p>}
        <Field label="vApp name"><input value={meta.vapp_name} onChange={e => onChangeMeta({ vapp_name: e.target.value })} placeholder="lab-my-lab" /></Field>
        <Field label="Description"><input value={meta.description} onChange={e => onChangeMeta({ description: e.target.value })} /></Field>
        <Field label="Org network (uplink)"><input value={meta.org_network} onChange={e => onChangeMeta({ org_network: e.target.value })} /></Field>
        <h3>vApp edge</h3>
        <Field label="1:1 NAT to gateway VM">
          <select value={meta.edge_nat?.vm || ''} onChange={e => onChangeMeta({ edge_nat: e.target.value ? { mode: 'ip_translation', vm: e.target.value } : null })}>
            <option value="">none</option>
            {vmNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <FirewallSection meta={meta} onChangeMeta={onChangeMeta} vmNames={vmNames} readOnly={readOnly} onOpenSetup={onOpenSetup} />
        <p className="hint">Select a device, network or link to edit it. Drag from a device's top handle to a network's bottom handle to add a NIC.</p>
      </div>
    )
  }

  if (selection.kind === 'node') {
    const n = selection.item; const d = n.data
    if (n.type === 'device') {
      return <DevicePanel n={n} d={d} catalog={catalog} onChangeNode={onChangeNode} onDelete={onDelete} readOnly={readOnly} />
    }
    return (
      <div className="inspector">
        <h3>Network</h3>
        <Field label="Name"><input value={d.name} onChange={e => onChangeNode(n.id, { name: e.target.value.replace(/[^A-Za-z0-9-]/g, '') })} /></Field>
        <Field label="CIDR"><input className="mono" value={d.cidr} onChange={e => onChangeNode(n.id, { cidr: e.target.value })} placeholder="192.168.10.0/24" /></Field>
        <Field label="Gateway address"><input className="mono" value={d.gateway} onChange={e => onChangeNode(n.id, { gateway: e.target.value })} placeholder="192.168.10.1" /></Field>
        <Field label="Routed uplink to org network"><input type="checkbox" checked={d.routed} onChange={e => onChangeNode(n.id, { routed: e.target.checked, pool: e.target.checked ? (d.pool || ['192.168.2.2', '192.168.2.2']) : null })} /></Field>
        {d.routed && (
          <div className="row">
            <Field label="Pool start"><input className="mono" value={d.pool?.[0] || ''} onChange={e => onChangeNode(n.id, { pool: [e.target.value, d.pool?.[1] || e.target.value] })} /></Field>
            <Field label="Pool end"><input className="mono" value={d.pool?.[1] || ''} onChange={e => onChangeNode(n.id, { pool: [d.pool?.[0] || e.target.value, e.target.value] })} /></Field>
          </div>
        )}
        <Field label="DNS (optional)"><input className="mono" value={d.dns} onChange={e => onChangeNode(n.id, { dns: e.target.value })} /></Field>
        <button className="danger" onClick={() => onDelete()}>Remove network</button>
      </div>
    )
  }

  const e = selection.item; const d = e.data || {}
  const dev = nodes.find(n => n.id === e.source)?.data?.name
  const net = nodes.find(n => n.id === e.target)?.data?.name
  return (
    <div className="inspector">
      <h3>NIC</h3>
      <div className="hint">{dev} → {net}</div>
      <Field label="NIC index (0 = primary / first interface)"><input type="number" min="0" value={d.index ?? 0} onChange={ev => onChangeEdge(e.id, { index: Number(ev.target.value) })} /></Field>
      <Field label="Address mode">
        <select value={d.mode || (d.ip ? 'MANUAL' : 'DHCP')} onChange={ev => onChangeEdge(e.id, { mode: ev.target.value })}>
          <option value="MANUAL">Static (MANUAL)</option>
          <option value="POOL">From network pool (POOL)</option>
          <option value="DHCP">DHCP</option>
          <option value="NONE">No address</option>
        </select>
      </Field>
      {(d.mode === 'MANUAL' || (!d.mode && d.ip)) && <Field label="IP address"><input className="mono" value={d.ip || ''} onChange={ev => onChangeEdge(e.id, { ip: ev.target.value })} placeholder="192.168.10.42" /></Field>}
      <button className="danger" onClick={() => onDelete()}>Remove NIC</button>
    </div>
  )
}

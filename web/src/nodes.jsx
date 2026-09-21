import React from 'react'
import { Handle, Position, BaseEdge, EdgeLabelRenderer, getStraightPath, useReactFlow } from '@xyflow/react'
import { iconFor, kindInfo } from './convert.js'

const ICONS = {
  server: (
    <svg viewBox="0 0 48 48" width="40" height="40"><rect x="10" y="6" width="28" height="36" rx="3" fill="#fff" stroke="#475569" strokeWidth="2"/>
      {[14, 22, 30].map(y => <rect key={y} x="15" y={y} width="18" height="4" rx="1" fill="#cbd5e1"/>)}<circle cx="31" cy="37" r="1.6" fill="#22c55e"/></svg>),
  desktop: (
    <svg viewBox="0 0 48 48" width="40" height="40"><rect x="6" y="8" width="36" height="24" rx="3" fill="#fff" stroke="#475569" strokeWidth="2"/>
      <rect x="9" y="11" width="30" height="18" fill="#e0ecff"/><rect x="18" y="36" width="12" height="3" fill="#475569"/><rect x="22" y="32" width="4" height="4" fill="#475569"/></svg>),
  winserver: (
    <svg viewBox="0 0 48 48" width="40" height="40"><rect x="10" y="6" width="28" height="36" rx="3" fill="#fff" stroke="#475569" strokeWidth="2"/>
      <rect x="16" y="12" width="7" height="7" fill="#2563eb"/><rect x="25" y="12" width="7" height="7" fill="#2563eb"/><rect x="16" y="21" width="7" height="7" fill="#2563eb"/><rect x="25" y="21" width="7" height="7" fill="#2563eb"/><circle cx="31" cy="37" r="1.6" fill="#22c55e"/></svg>),
  router: (
    <svg viewBox="0 0 48 48" width="40" height="40"><rect x="4" y="16" width="40" height="18" rx="9" fill="#fff" stroke="#2563eb" strokeWidth="2"/>
      <path d="M13 25h10m0 0l-3-3m3 3l-3 3M35 25H25m0 0l3-3m-3 3l3 3" stroke="#2563eb" strokeWidth="2" fill="none"/><path d="M14 16V9m20 7V9" stroke="#475569" strokeWidth="2"/></svg>),
  firewall: (
    <svg viewBox="0 0 48 48" width="40" height="40"><rect x="6" y="10" width="36" height="28" rx="3" fill="#fff" stroke="#dc2626" strokeWidth="2"/>
      {[14, 22, 30].map((y, i) => <g key={y}>{[0, 1, 2].map(k => <rect key={k} x={9 + k * 11 + (i % 2) * 5} y={y} width="9" height="5" fill="#fecaca" stroke="#dc2626" strokeWidth="1"/>)}</g>)}</svg>),
  gateway: (
    <svg viewBox="0 0 48 48" width="40" height="40"><rect x="4" y="14" width="40" height="18" rx="9" fill="#fff" stroke="#22c55e" strokeWidth="2"/>
      <path d="M13 23h10m0 0l-3-3m3 3l-3 3M35 23H25m0 0l3-3m-3 3l3 3" stroke="#22c55e" strokeWidth="2" fill="none"/>
      <rect x="14" y="35" width="20" height="9" rx="2" fill="#14532d"/><text x="24" y="42" textAnchor="middle" fontSize="7" fontFamily="Menlo, monospace" fill="#bbf7d0">NAT</text></svg>),
  hypervisor: (
    <svg viewBox="0 0 48 48" width="40" height="40"><rect x="6" y="8" width="36" height="32" rx="3" fill="#fff" stroke="#475569" strokeWidth="2"/>
      {[[10, 12], [26, 12], [10, 26], [26, 26]].map(([x, y]) => <rect key={x + y} x={x} y={y} width="12" height="10" rx="1" fill="#e2e8f0" stroke="#94a3b8"/>)}</svg>),
}

export const iconByKind = (kind, template) => ICONS[kind === 'windesktop' ? 'desktop' : kind] || ICONS[iconFor(template)] || ICONS.server

export function DeviceNode({ data, selected }) {
  const icon = iconByKind(data.kind, data.template)
  return (
    <div className={`node device ${selected ? 'selected' : ''}`}>
      <Handle type="source" position={Position.Top} className="handle" />
      <div className="icon">{icon}</div>
      <div className="title">{data.name}</div>
      <div className="sub">{data.existing ? (data.os || 'existing VM') : (data.template || <em className="warn">choose an image</em>)}</div>
      <div className="meta">{kindInfo(data.kind).label} · {data.cpus} vCPU · {Math.round((data.memory || 0) / 1024)} GB{data.existing && data.status ? ` · ${data.status}` : ''}</div>
    </div>
  )
}

export function NetworkNode({ data, selected }) {
  return (
    <div className={`node network ${data.routed ? 'routed' : ''} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Bottom} className="handle" />
      <div className="title">{data.routed ? 'UPLINK · ' : 'NETWORK · '}{data.name}</div>
      <div className="sub mono">{data.cidr || '?'} · gw {data.gateway || '?'}</div>
      {data.routed && <div className="meta">routed to org network · pool {data.pool ? data.pool.join('–') : 'none'}</div>}
    </div>
  )
}

export function NicEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }) {
  const [path, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const label = data?.mode === 'MANUAL' ? (data.ip || '?') : data?.mode === 'POOL' && data?.ip ? `POOL · ${data.ip}` : (data?.mode || 'DHCP')
  return (
    <>
      <BaseEdge id={id} path={path} className={`nic-edge ${selected ? 'selected' : ''}`} />
      <EdgeLabelRenderer>
        <div className={`edge-label ${selected ? 'selected' : ''}`} style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}>
          <span className="nic">nic{data?.index ?? 0}</span> {label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export { ICONS }
export const nodeTypes = { device: DeviceNode, network: NetworkNode }
export const edgeTypes = { nic: NicEdge }

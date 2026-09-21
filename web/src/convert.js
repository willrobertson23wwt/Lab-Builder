// lab.yaml (as JSON) <-> React Flow nodes/edges. The yaml is the contract the
// Terraform module reads; the canvas is just a view of it plus node positions.

export const netId = (name) => `net:${name}`
export const vmId = (name) => `vm:${name}`

export function labToGraph(lab, layout) {
  const pos = (id, fallback) => (layout && layout[id]) || fallback
  const nodes = [], edges = []
  const nets = Object.entries(lab.networks || {})
  nets.forEach(([name, n], i) => {
    nodes.push({ id: netId(name), type: 'network', position: pos(netId(name), { x: 80 + i * 340, y: 60 }),
      data: { name, cidr: n.cidr || '', gateway: n.gateway || '', routed: !!n.routed, pool: n.pool || null, dns: n.dns || '' } })
  })
  Object.entries(lab.vms || {}).forEach(([name, vm], i) => {
    nodes.push({ id: vmId(name), type: 'device', position: pos(vmId(name), { x: 80 + i * 280, y: 380 }),
      data: { name, kind: vm.kind || iconFor(vm.template, vm.os), template: vm.template || '', cpus: vm.cpus ?? 2, memory: vm.memory ?? 4096, disk_mb: vm.disk_mb ?? null, computer_name: vm.computer_name || '', existing: !!vm.existing, os: vm.os || '', status: vm.status || '' } })
    ;(vm.nics || []).forEach((nic, k) => {
      const net = (lab.networks || {})[nic.net] || {}
      const mode = nic.mode || (nic.ip ? 'MANUAL' : 'DHCP')
      // a single-address pool makes POOL deterministic; show that address
      const ip = nic.ip || (mode === 'POOL' && net.pool && net.pool[0] === net.pool[1] ? net.pool[0] : '')
      edges.push({ id: `nic:${name}:${k}`, source: vmId(name), target: netId(nic.net), type: 'nic',
        data: { index: k, ip, mode } })
    })
  })
  return { nodes, edges }
}

export function graphToLab(meta, nodes, edges) {
  const networks = {}, vms = {}
  nodes.filter(n => n.type === 'network').forEach(n => {
    const d = n.data
    const net = { cidr: d.cidr, gateway: d.gateway }
    if (d.routed) net.routed = true
    if (d.pool && d.pool[0]) net.pool = d.pool
    if (d.dns) net.dns = d.dns
    networks[d.name] = net
  })
  const netName = Object.fromEntries(nodes.filter(n => n.type === 'network').map(n => [n.id, n.data.name]))
  nodes.filter(n => n.type === 'device').forEach(n => {
    const d = n.data
    const nics = edges.filter(e => e.source === n.id && netName[e.target])
      .sort((a, b) => (a.data?.index ?? 0) - (b.data?.index ?? 0))
      .map(e => {
        const nic = { net: netName[e.target] }
        const mode = e.data?.mode || (e.data?.ip ? 'MANUAL' : 'DHCP')
        if (mode === 'MANUAL' && e.data?.ip) nic.ip = e.data.ip
        else nic.mode = mode
        return nic
      })
    const vm = { template: d.template, kind: d.kind, cpus: Number(d.cpus) || 2, memory: Number(d.memory) || 4096 }
    if (d.disk_mb) vm.disk_mb = Number(d.disk_mb)
    if (d.computer_name) vm.computer_name = d.computer_name
    vm.nics = nics
    vms[d.name] = vm
  })
  const lab = { vapp_name: meta.vapp_name, description: meta.description || '', networks, vms }
  if (meta.org_network) lab.org_network = meta.org_network
  if (meta.edge_firewall) lab.edge_firewall = meta.edge_firewall
  if (meta.edge_nat && meta.edge_nat.vm) lab.edge_nat = meta.edge_nat
  return lab
}

export function layoutOf(nodes) {
  return Object.fromEntries(nodes.map(n => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]))
}

// House preset: what the reference demo vApp carries on its edge today.
// Default drop, everything from outside allowed in to the vApp, everything
// from the vApp allowed out; the edge maps its external IP 1:1 to `gw`.
export function defaultEdge(gw) {
  return {
    edge_firewall: {
      default_action: 'drop', log_default_action: false,
      rules: [
        { name: 'Allow incoming', policy: 'allow', protocol: 'any', source_ip: 'external', destination_ip: 'internal' },
        { name: 'Allow all outgoing traffic', policy: 'allow', protocol: 'any', source_ip: 'internal', destination_ip: 'external' },
      ],
    },
    edge_nat: { mode: 'ip_translation', vm: gw },
  }
}

export const emptyRule = () => ({ name: 'New rule', policy: 'allow', protocol: 'any', source_ip: 'any', destination_ip: 'any', destination_port: 'any', enabled: true })

// Generic device types shown in the palette. `match` filters the catalog for
// that type; `template` is the default image chosen on drop.
export const KINDS = [
  { kind: 'gateway',    label: 'Gateway (NAT)',   template: 'labs-ubuntu2404-server-latest', match: /ubuntu.*server|centos8-serv|rhel|rocky|debian/i },
  { kind: 'server',     label: 'Linux server',    template: 'labs-ubuntu2404-server-latest', match: /ubuntu.*server|centos8-serv|rhel|rocky|debian/i },
  { kind: 'desktop',    label: 'Linux desktop',   template: 'labs-ubuntu2404-desk-latest',   match: /ubuntu.*desk|centos8-desk|xrdp/i },
  { kind: 'winserver',  label: 'Windows Server',  template: 'labs-win2k22-latest',           match: /win2k|windows.*server/i },
  { kind: 'windesktop', label: 'Windows desktop', template: 'labs-win11-latest',             match: /win11|win10|windows-1/i },
  { kind: 'router',     label: 'Router',          template: 'labs-csr-latest',               match: /csr|vyos|router|ios/i },
  { kind: 'firewall',   label: 'Firewall',        template: '',                              match: /fw|ngfw|palo|firewall|pangfw/i },
  { kind: 'hypervisor', label: 'Hypervisor',      template: 'vsphere8-gold',                 match: /esx|vsphere|vcenter/i },
  { kind: 'other',      label: 'Other / bundle',  template: '',                              match: /.*/ },
]
export const kindInfo = (kind) => KINDS.find(k => k.kind === kind) || KINDS[KINDS.length - 1]

export function iconFor(template = '', os = '') {
  const s = (template + ' ' + os).toLowerCase()
  if (/csr|vyos|router|ios/.test(s)) return 'router'
  if (/fw|ngfw|palo|firewall/.test(s)) return 'firewall'
  if (/win|windows/.test(s)) return /desk|win11|win10|windows 10|windows 11/.test(s) ? 'windesktop' : 'winserver'
  if (/desk|xrdp/.test(s)) return 'desktop'
  if (/esx|vsphere|vcenter/.test(s)) return 'hypervisor'
  return 'server'
}

// Wire a freshly dropped gateway device the house way: NIC0 on the routed
// uplink (POOL -> 192.168.2.2 from the /30 pool), NIC1 on the lab network in
// DHCP mode (the guest is configured as the lab gateway by Ansible; vCD does
// not need to know the address). Returns the edges to add.
export function wireGateway(vmNodeId, nodes) {
  const nets = nodes.filter(n => n.type === 'network')
  const uplink = nets.find(n => n.data.routed)
  const lab = nets.find(n => !n.data.routed && /^lab/i.test(n.data.name)) || nets.find(n => !n.data.routed)
  const edges = []
  if (uplink) edges.push({ id: `nic:${vmNodeId}:${Date.now()}a`, source: vmNodeId, target: uplink.id, type: 'nic',
    data: { index: 0, mode: 'POOL', ip: uplink.data.pool?.[0] || '' } })
  if (lab) edges.push({ id: `nic:${vmNodeId}:${Date.now()}b`, source: vmNodeId, target: lab.id, type: 'nic',
    data: { index: edges.length, mode: 'DHCP', ip: '' } })
  return edges
}

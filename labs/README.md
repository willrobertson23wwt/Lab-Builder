# labs/

One folder per planned lab, written by `/lab-plan <path-to-lab-guide>`:

```
labs/<slug>/
  lab.yaml            the build spec (this is what gets reviewed and approved)
  PLAN.md             the human-readable plan: images, network, open questions
  terraform/          copy of terraform/lab-root; state lives here, one vApp per lab
```

Nothing under `labs/` is applied without an explicit `scripts/tf.sh --lab <slug> apply`.

## The gateway device (default)

Every lab gets one **Gateway (NAT)** device: the latest Ubuntu server gold master
(`labs-ubuntu2404-server-latest`), named `gateway`. NIC0 sits on the routed `Gateway`
uplink and takes 192.168.2.2 from the /30's single-address pool; NIC1 sits on the `Lab`
network and NIC2 on `Management` (when present), both in DHCP mode: the guest itself is
configured as 192.168.10.1 / 10.0.0.1 by Ansible, vCD only needs the NIC attached. The
vApp edge maps its external address 1:1 to this VM (`edge_nat`), and the gateway VM does
all NAT, DNS and port forwarding for the lab (configured by Ansible after the build).
The designer places it automatically on **New** and wires it when dropped from the palette.

## lab.yaml schema

```yaml
vapp_name: lab-broken-path          # new vApp to create; must not already exist in the VDC
description: "Linux Intermediate: Broken Path"
org_network: my-org-network-01    # optional; defaults to TF_VAR_org_network from .env

networks:                            # vApp networks; exactly one is `routed: true`
  Gateway:
    routed: true
    cidr: 192.168.2.0/30
    gateway: 192.168.2.1             # the vApp edge
    pool: [192.168.2.2, 192.168.2.2] # static pool; the gateway VM takes POOL from it
  Lab:
    cidr: 192.168.10.0/24
    gateway: 192.168.10.1            # the gateway VM's lab address
  Management:
    cidr: 10.0.0.0/24
    gateway: 10.0.0.1

vms:
  gateway:
    template: labs-ubuntu2404-server-latest   # a template in your catalog (scripts/catalog_match.py)
    cpus: 2
    memory: 4096
    disk_mb: 32768                   # optional override of the template's first disk
    nics:                            # first NIC is primary; order = NIC index
      - {net: Gateway, mode: POOL}            # -> 192.168.2.2 from the /30 pool
      - {net: Lab, mode: DHCP}                # guest is configured as 192.168.10.1 by Ansible
      - {net: Management, mode: DHCP}
  client01:
    template: labs-ubuntu2404-server-latest
    nics:
      - {net: Lab, ip: 192.168.10.42}
      - {net: Management, ip: 10.0.0.10}

edge_firewall:                       # optional; rules on the vApp edge of the routed network
  default_action: drop               # house preset: allow all in + allow all out, default drop
  log_default_action: false
  rules:
    - {name: Allow incoming, protocol: any, source_ip: external, destination_ip: internal}
    - {name: Allow all outgoing traffic, protocol: any, source_ip: internal, destination_ip: external}
    # a guide-specific rule set comes from scripts/setup_rules.py <SETUP.md>, e.g.:
    # - {name: Allow portal SSH in, protocol: tcp, source_ip: external,
    #    destination_vm: gateway, destination_vm_ip_type: NAT, destination_port: "22"}

edge_nat:                            # optional; NAT on the vApp edge
  mode: ip_translation               # house pattern: the edge's external IP maps 1:1 to the gateway VM
  vm: gateway
  # or: mode: port_forwarding, rules: [{external_port: 2210, vm: gateway, nic: 0, internal_port: 2210, protocol: TCP}]
```

Rules: `source_ip` / `destination_ip` take an address, a range, `any`, `internal` or
`external`. Naming a VM (`source_vm` / `destination_vm`) pins the rule to that VM's NIC 0 (override with
`_vm_nic`) and uses `_ip_type` `assigned` (its internal address, the default for sources) or
`NAT` (the vApp's external address, the default for destinations).

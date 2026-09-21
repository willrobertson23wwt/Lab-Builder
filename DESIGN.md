# Design: lab guide -> approved Terraform -> vApp

Milestone 1 (power control of an existing vApp), milestone 2 (the planner and
Terraform module) and the Lab Designer UI are done. This document records the
design and what was learned about the target environment so the design is
grounded in it.

## Goal

Read a lab guide produced by the `/lab` skill in the learning-path pipeline,
plan the vApp that hosts it, suggest images from `atc-gold-masters`, lay out the
network, emit Terraform, and stop for approval before anything is built.

## What a target environment looks like (discovered, not assumed)

Everything below was verified against a real NSX-T backed vCloud Director 10.6
tenant. Names, hosts and addresses are configured in `.env`, never in source.

- One Org VDC and one **routed Org VDC network** behind an NSX-T edge gateway.
  A tenant account typically cannot see the edge gateway itself (403), so this
  project never touches edge-gateway NAT or firewall; everything happens inside
  the vApp.
- Every lab vApp follows one pattern:
  - one **routed** vApp network (`Gateway`) uplinked to the org network, a tiny
    subnet (192.168.2.0/30) with gateway .1 (the vApp edge) and a one-address
    static pool (.2) for the gateway VM;
  - one or more **isolated** vApp networks (`Lab`, `Management`, ...);
  - a Linux **gateway VM** with a NIC on every network that does routing, NAT,
    DNS and the portal port forwards (e.g. 2210 -> client01:22);
  - lab VMs with a NIC on `Lab` and a NIC on `Management`.
  - The vApp edge gets an external address from the org network when the vApp
    is deployed; that is the "outside IP" a lab portal connects to, and it can
    change per deployment.
- The vApp edge firewall is real and manageable with the `vmware/vcd` provider:
  importing a live vApp's rules showed portal SSH in to the gateway VM
  (`source_ip = external`, `destination_vm_ip_type = NAT`) and the edge NAT as a
  1:1 IP translation (`ipTranslation`, automatic) to the gateway VM's NIC 0.
- The golden-image catalog holds single-VM base images (Ubuntu server/desktop,
  Windows client/server, CentOS, a Cisco CSR, VyOS) plus a few multi-VM bundles.
  Base images are small (2 vCPU / 1 GB / 32 GB / 1 NIC), so the plan always
  sets sizing and adds NICs.
- Guest configuration (accounts, seeded files, the deliberate faults) is NOT
  Terraform's job. Lab repos carry Ansible for that; the vApp is built bare and
  the guide's `SETUP.md` is applied afterwards.

## Pieces

| piece | where | role |
|---|---|---|
| `terraform/modules/lab-vapp` | module | vApp + networks + VMs from templates + optional edge firewall/port forwards, all driven by one `lab.yaml` |
| `terraform/lab-root` | template | per-lab root copied to `labs/<slug>/terraform/` so each lab has its own state |
| `scripts/catalog_match.py` | helper | OS/role words -> gold-master template, confirmed against the live catalog |
| `scripts/inventory.py` | helper | read-only view of catalogs, networks, and existing vApps (reference shapes) |
| `.claude/skills/lab-plan` | skill | the workflow: read guide -> `lab.yaml` + `PLAN.md` -> `terraform plan` -> STOP |
| `scripts/tf.sh --lab <slug>` | wrapper | `plan` / `apply` / `destroy` for one lab, creds from `.env` |

## Approval gate

`/lab-plan` ends after `terraform plan` with the plan summary and the PLAN.md.
Building is a separate, explicit `scripts/tf.sh --lab <slug> apply` that the
user runs or asks for by name. The skill never runs `apply`.

## Gateway default (decided 2026-09-21)

The gateway device is always the latest Ubuntu server image. NIC0 = routed uplink at
192.168.2.2/30 (POOL from a one-address pool), NIC1 = lab network in DHCP mode (the
guest is configured as the lab gateway by Ansible; changed from MANUAL after the first
successful build on 2026-09-21). It
handles all NAT for the lab; the vApp edge only does the 1:1 external-IP mapping to it.

## Firewall modes (decided 2026-09-21)

Three ways to set the vApp edge firewall in the designer, all writing the same
`edge_firewall` block:

1. **House preset** (default on New / gateway drop): a copy of the reference
   demo vApp's edge: default drop, "Allow incoming" any external→internal,
   "Allow all outgoing traffic" any internal→external, plus the 1:1 NAT.
2. **From SETUP.md**: `scripts/setup_rules.py` parses the "vApp edge firewall"
   table the `/lab` skill writes (also `POST /api/rules/parse-setup`).
3. **Custom**: the rule editor in the inspector (name, policy, protocol,
   from/to as zone, VM or ip/range, port, enabled, ordering).

## Gotchas learned from live builds

- The NSX-T vApp firewall stores a `tcp&udp` rule as `tcp` only (seen as drift on
  the first built lab). Write separate udp and tcp rules; the preset does.
- The provider's `status_text` output lags one apply behind a power change.
  `scripts/discover.py --vapp` is the live check.

## Open questions

1. ~~Port forwards on the vApp edge~~ Decided: the gateway VM does all NAT and
   forwards; the edge only maps its external IP 1:1 to the gateway.
2. **Guest customization**: off by default. VCD could push hostnames and the
   MANUAL IPs into Ubuntu guests via VMware Tools, which would save the first
   Ansible step, but it also rewrites netplan on first boot. Decide per lab.
3. **Sizing defaults**: module default is 2 vCPU / 4 GB. Built labs run 4/8.
4. **Integration**: `/lab-plan` lives in this repo for now. When it settles, it
   can move into the pipeline's skill set next to `/lab` and `/lab-topology`.

---
name: lab-plan
description: Read a lab guide (environment.md + SETUP.md from the /lab skill), plan the vApp: gold-master images, networks, VMs, edge rules; write labs/<slug>/lab.yaml + PLAN.md, copy the Terraform root, run terraform plan, and STOP for approval. Never applies.
---

Plan the vCloud Director build for one lab guide. `$ARGUMENTS` is a path to a
lab folder (drafted `labs/<slug>/` in a learning-path repo, or a published lab
repo's `labdocs/docs/`). Output goes to `labs/<slug>/` in this repo.

## 1. Read the guide

- `environment.md`: the device table (hosts, lab and management addresses,
  roles, OS), the address plan, who the learner logs into.
- `SETUP.md` (if present): the interface map (NIC per segment), the vApp edge
  firewall table, port forwards (2210/2211 style), gateway VM duties, sizing
  hints, anything that says "must be a real L2 segment".
- `index.md` title -> `description`.

Extract: hostnames, OS per host, per-host NICs with addresses, the subnets,
which host is the gateway, which ports the portal needs, outbound needs
(ICMP, DNS, traceroute UDP range, 80/443 for maintenance).

## 2. Pick images

Run `python3 scripts/catalog_match.py --json "<os/role words>" ...` once for
all hosts. Report each match with its note. If a host has NO match, say so and
offer the nearest template from `--list`; do not invent a template name. The
CSR template has 8 NICs and its own credentials (template description).

## 3. Lay out the network (house pattern, see DESIGN.md)

- Exactly one `routed: true` network named `Gateway`, `192.168.2.0/30`,
  gateway `.1`, pool `.2-.2`; it uplinks to the org network from `.env`
  (`TF_VAR_org_network`), so leave `org_network` out of `lab.yaml`.
- One isolated network per subnet in the guide (`Lab`, `Management`, ...),
  gateway = the gateway VM's address on that subnet.
- Gateway VM: NIC0 `Gateway` POOL, then one DHCP-mode NIC per isolated network
  (the guest is configured as each network's gateway address by Ansible).
  Every other VM: MANUAL NICs with the guide's addresses. NIC order becomes the
  interface order in the guest (eth0, eth1, ...).
- Edge firewall: if the guide's `SETUP.md` has a "vApp edge firewall" table,
  convert it with `scripts/setup_rules.py <SETUP.md> --gateway gateway --yaml`
  and paste the result into `lab.yaml` (it expands combined protocols and port
  lists, pins "gateway VM"/"lab VM" destinations to the gateway with the NAT
  address type, and disables rows marked maintenance). Without a table, use
  the house preset: default drop, allow all external→internal, allow all
  internal→external.
- `edge_nat: {mode: ip_translation, vm: <gateway>}`: the edge maps its external
  address 1:1 to the gateway VM (how every existing lab does it). Port forwards
  to the other hosts stay on the gateway VM's nftables unless the guide says
  otherwise.

## 4. Write the plan

- `labs/<slug>/lab.yaml` per `labs/README.md`. `vapp_name` = `lab-<slug>`;
  check it does not exist (`python3 scripts/discover.py --vapp lab-<slug>`
  must say "No vApps matched").
- `labs/<slug>/PLAN.md`: a table of VMs (image, sizing, NICs/addresses), a
  table of networks, the firewall table, the list of things Terraform does
  NOT do (guest accounts, seeded files, faults, gateway nftables), and every
  assumption you made where the guide was silent.
- `cp -R terraform/lab-root labs/<slug>/terraform` (skip if it exists).

## 5. Plan, then STOP

```
scripts/tf.sh --lab <slug> init -input=false
scripts/tf.sh --lab <slug> plan -input=false
```

Summarize the plan (resources to add, anything replaced or destroyed must be
zero for a new lab) and show PLAN.md. Then stop. Do not run `apply`; the user
does that with `scripts/tf.sh --lab <slug> apply` or asks for it explicitly.
When they approve, power on is `-var power_on=true`.

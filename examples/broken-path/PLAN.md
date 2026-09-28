# Build plan: Broken Path (`lab-broken-path`)

Source guide: github.com/wwt/linux-broken-path (`labdocs/docs/environment.md`, `SETUP.md`).
Planned 2026-09-21. Status: **planned, not built**. `terraform plan`: 9 to add, 0 to change, 0 to destroy.

## VMs

| VM | Image (atc-gold-masters) | vCPU / RAM / disk | NIC0 | NIC1 | NIC2 |
|---|---|---|---|---|---|
| gateway  | labs-ubuntu2404-server-latest | 2 / 4 GB / 32 GB | Gateway, POOL (192.168.2.2) | Lab 192.168.10.1 | Management 10.0.0.1 |
| client01 | labs-ubuntu2404-server-latest | 2 / 4 GB / 32 GB | Lab 192.168.10.42 | Management 10.0.0.10 | |
| web01    | labs-ubuntu2404-server-latest | 2 / 4 GB / 32 GB | Lab 192.168.10.80 | Management 10.0.0.11 | |

All three matched the same image; the guide says "Ubuntu 24.04 LTS, no desktop" for every host.
The hand-built version of this lab runs 4 vCPU / 8 GB per VM; this plan uses the module default of 2 / 4. Raise in `lab.yaml` if the dry run is sluggish.

## Networks

| vApp network | Type | Subnet | Gateway | Notes |
|---|---|---|---|---|
| Gateway    | routed to the org network (`TF_VAR_org_network`) | 192.168.2.0/30 | 192.168.2.1 (vApp edge) | static pool .2 for the gateway VM |
| Lab        | isolated | 192.168.10.0/24 | 192.168.10.1 (gateway VM) | the learner-facing segment |
| Management | isolated | 10.0.0.0/24 | 10.0.0.1 (gateway VM) | portal/management plane, never in exercises |

## vApp edge

NAT: IP translation, automatic, external address -> gateway VM NIC0 (same as the existing lab).

| # | Rule | Action | Proto | Source | Destination | Ports |
|---|---|---|---|---|---|---|
| 1 | Allow portal SSH in   | allow | tcp | external | gateway VM (NAT addr) | 22 |
| 2 | Allow portal SSH in 2 | allow | tcp | external | gateway VM (NAT addr) | 2210-2211 |
| 3 | Allow ping out        | allow | icmp | internal | external | any |
| 4 | Allow traceroute out  | allow | udp | internal | external | 33434-33534 |
| 5 | Allow DNS out (udp)   | allow | udp | internal | external | 53 |
| 6 | Allow DNS out (tcp)   | allow | tcp | internal | external | 53 |
| 7 | Maintenance web out   | allow, **disabled** | tcp | internal | external | 80 |
| 8 | Maintenance https out | allow, **disabled** | tcp | internal | external | 443 |
| - | default | drop, logging on | | | | |

Enable 7 and 8 only while running `apt` during image maintenance, then disable again (SETUP.md house rule).

## Not done by Terraform (apply SETUP.md / Ansible after build)

- Guest networking inside the VMs (netplan, the deliberate `/26` on client01, no default route on eth1). Guest customization is off, so the MANUAL addresses above are recorded in vCD only.
- Gateway VM duties: ip_forward, nftables NAT and management SNAT, dnsmasq, port forwards 2210 -> client01:22 and 2211 -> web01:22.
- `labuser` accounts, nginx on web01, seeded files, Docker removal.
- Snapshot after dry run.

## Assumptions

- Interface order follows NIC order (gateway: ens160 WAN, ens192 lab, ens224 mgmt; hosts: eth0 lab, eth1 mgmt).
- Guide is silent on sizing; module defaults used.
- The vApp name `lab-broken-path` was confirmed unused on 2026-09-21.

## To build (needs explicit approval)

```
scripts/tf.sh --lab broken-path apply
scripts/tf.sh --lab broken-path apply -var power_on=true   # when ready to boot
```

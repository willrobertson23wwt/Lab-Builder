# Lab Builder: instructions for Claude Code

This repo designs and builds hands-on lab environments as vApps in VMware Cloud
Director (vCD) from a drag-and-drop canvas or a `lab.yaml` file, using Terraform.
Read `README.md` first for the human-facing overview, then `DESIGN.md` for the
environment facts the design rests on.

## Ground rules

- **Never write credentials into the repo.** They live only in `.env` (gitignored,
  mode 600). Never `cat .env`, never echo `VCD_PASSWORD`, never paste a password
  the user gives you into a file or command; ask them to edit `.env` themselves.
- **Never run `terraform apply` or `destroy`, or call the service's apply/destroy
  endpoints, without the user's explicit go-ahead for that specific lab.**
  `terraform plan` and every `scripts/discover.py` / `scripts/inventory.py`
  command are read-only and always fine.
- `prevent_destroy` guards the imported vApp in `terraform/`. Labs under
  `labs/<slug>/` are meant to be created and destroyed; still confirm first.
- Existing vApps in the VDC that this repo did not create are other people's
  labs. Read them (`inventory.py vapp <name>`), never modify them.

## Setup on a new machine

```
scripts/setup.sh          # terraform, python venv, web UI build, .env template
# user edits .env (VCD_URL, VCD_ORG, VCD_USER, VCD_PASSWORD)
python3 scripts/discover.py           # confirms login; prints the Org VDC -> TF_VAR_vdc
python3 scripts/inventory.py networks # routed org network -> TF_VAR_org_network
python3 scripts/inventory.py catalogs # golden-image catalog -> VCD_CATALOG / TF_VAR_catalog
bin/lab-builder install && lab-builder ui   # designer at http://127.0.0.1:8765 (or scripts/ui.sh)
```

If `terraform` is not on PATH after setup, it is in `~/.local/bin`.

## Where things are

| path | what |
|---|---|
| `terraform/modules/lab-vapp` | the module: vApp, networks, VMs from templates, vApp-edge firewall + NAT, driven by `lab.yaml` |
| `terraform/lab-root` | per-lab root template; copied to `labs/<slug>/terraform/` (one state per lab) |
| `terraform/` (root) | milestone 1: power control of one imported vApp |
| `labs/<slug>/lab.yaml` | the build spec; schema in `labs/README.md` |
| `labs/<slug>/PLAN.md` | human-readable plan produced by `/lab-plan` |
| `bin/lab-builder` | CLI: ui, new, list, plan, build, power, destroy, status |
| `scripts/tf.sh [--lab <slug>] …` | terraform with `.env` loaded |
| `scripts/discover.py`, `scripts/inventory.py`, `scripts/catalog_match.py` | read-only vCD helpers (stdlib only) |
| `server/app.py` | FastAPI local service behind the designer (jobs for plan/apply/power/destroy) |
| `web/` | Vite + React + React Flow designer; `npm run build` -> `web/dist` |
| `.claude/skills/lab-plan` | skill: lab guide -> `lab.yaml` + `PLAN.md` + `terraform plan`, then STOP |

## Typical requests and how to handle them

- "Plan a lab from this guide": run `/lab-plan <path>`. It stops after `plan`.
- "Build lab X": confirm the slug, then `scripts/tf.sh --lab X apply` (or the
  user clicks Apply in the designer). Verify with `discover.py --vapp <vapp_name>`.
- "Power X on/off": planned labs `scripts/tf.sh --lab X apply -var power_on=true|false`;
  any other vApp: the designer's Load menu, or the service's `/api/vapps/<name>/power`.
- "What is in vApp Y": `inventory.py vapp Y` and `inventory.py netconfig Y`.
- UI change: edit `web/src/*`, `cd web && npm run build`, restart `scripts/ui.sh`.
- Service change: edit `server/app.py` (Python 3.9 compatible: use `Optional[...]`,
  not `X | None`), restart `scripts/ui.sh`.

## House pattern for a lab vApp (see DESIGN.md)

One routed vApp network `Gateway` (192.168.2.0/30, pool .2-.2) uplinked to the org
network; isolated `Lab` and `Management` networks; a `gateway` VM (latest Ubuntu
server image) with NIC0 POOL on `Gateway`, NIC1 DHCP on `Lab`, NIC2 DHCP on
`Management`; vApp edge does 1:1 IP translation to the gateway VM and allows portal
SSH 22 / 2210-2211 in, ICMP / UDP 33434-33534 / DNS out, default drop. The gateway
VM does all NAT, DNS and port forwarding for the lab (Ansible, after the build).

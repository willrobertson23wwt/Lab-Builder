# Lab Builder

Design a hands-on lab on a canvas, review the plan, and build it as a vApp in
VMware Cloud Director (vCD) with Terraform.

Lab Builder was written for a WWT ATC lab tenant, but nothing site-specific is in the
source: hosts, org, VDC, network and catalog names all live in one gitignored `.env`
file, so it works against any vCD tenant that gives you a catalog of golden images and
a routed Org VDC network.

**Using Claude Code?** Paste this repo's link and ask it to set the tool up. The
[`CLAUDE.md`](CLAUDE.md) file tells it how the repo works and what it must never do
(touch credentials, or build or destroy anything without your say-so).

---

## What it does

```
 lab guide / your drawing  ->  labs/<slug>/lab.yaml  ->  terraform plan  ->  you approve  ->  vApp
```

- **Lab Designer** (web UI, runs on your machine): drag device tiles onto a dark
  canvas, link them to network segments, pick a golden image and sizing per device,
  then Save, Plan, and Apply. The Load menu also shows every vApp already in your VDC,
  read-only, with power on/off.
- **`lab.yaml`** is the contract. The canvas is just a view of it; you can also write it
  by hand or let the `/lab-plan` skill generate it from a lab guide.
- **Terraform module** builds the vApp: networks, VMs cloned from catalog templates
  with the NICs and addresses you drew, and the vApp-edge firewall and NAT.
- **Approval gate**: nothing is built until you click Apply and type the lab's name, or
  run `apply` yourself. Apply runs exactly the plan you reviewed.

What it does **not** do: configure the guests. Accounts, packages, seeded files, and
the gateway VM's NAT/DNS/port-forwarding are applied afterwards (Ansible, in the lab
repos). Terraform builds the bare environment.

## Requirements

- macOS or Linux (Windows: use WSL). Network access to your vCD tenant.
- Python 3.9+, Node.js 20+ (for the web UI only), `curl`, `unzip`.
- Terraform 1.6+ (`scripts/setup.sh` installs 1.16 into `~/.local/bin` if missing).
- A vCD tenant account that can create vApps in one Org VDC. Username/password
  (integrated or LDAP) or an API token.

## Install

```bash
git clone https://github.com/willrobertson23wwt/Lab-Builder.git
cd Lab-Builder
scripts/setup.sh
```

The script installs Terraform if needed, creates a Python virtualenv for the local
service, builds the web UI, downloads the Terraform provider, and creates `.env` from
`.env.example`. Re-running it is safe.

### Configure `.env`

Open `.env` (it is gitignored and mode 600; never commit it) and set:

| variable | meaning |
|---|---|
| `VCD_URL` | tenant API endpoint, `https://<vcd-host>/api` |
| `VCD_ORG` | your organization name (from the tenant portal URL) |
| `VCD_AUTH_TYPE` | `integrated` for username/password; `api_token` if your org allows tokens |
| `VCD_USER`, `VCD_PASSWORD` | the account you log into the portal with (or `VCD_API_TOKEN`) |
| `VCD_ALLOW_UNVERIFIED_SSL` | `true` if the vCD certificate is not trusted by your machine |
| `TF_VAR_vdc` | the Org VDC that holds your vApps |
| `TF_VAR_vcd_url`, `TF_VAR_vcd_org` | same URL and org, for Terraform |
| `TF_VAR_org_network` | the routed Org VDC network lab gateways uplink to |
| `VCD_CATALOG`, `TF_VAR_catalog` | the catalog holding your golden images |

Discover the last three with the read-only helpers:

```bash
python3 scripts/discover.py             # confirms login; lists Org VDCs and vApps
python3 scripts/inventory.py networks   # Org VDC networks (pick the routed one)
python3 scripts/inventory.py catalogs   # catalogs and the templates inside them
```

The palette's default image per device type (`web/src/convert.js`, `KINDS`) and the
guide matcher's rules (`scripts/catalog_match.py`, `RULES`) name templates such as
`labs-ubuntu2404-server-latest`. If your catalog uses other names, edit those two lists;
everything still works without them, you just pick the image by hand in the inspector.

## Use the designer

```bash
scripts/ui.sh        # then open http://127.0.0.1:8765
```

1. **New** and give the lab a short slug. You get three networks and a wired gateway:
   `Gateway` (routed uplink, 192.168.2.0/30), `Lab` (192.168.10.0/24), `Management`
   (10.0.0.0/24), and a `gateway` VM on the latest Ubuntu server image with NIC0 on the
   uplink as 192.168.2.2 and DHCP-mode NICs on `Lab` and `Management`.
2. **Drag devices** from the palette (Linux server, Linux desktop, Windows Server,
   Windows desktop, Router, Firewall, Hypervisor). Select one to choose its golden image
   and vCPU/memory/disk in the inspector. Drag more **Network segment** tiles for extra
   subnets.
3. **Draw NICs**: drag from a device's top handle to a network's bottom handle. Select
   the link to set its NIC index and address mode (static, pool, DHCP).
4. **vApp edge**: with nothing selected, the inspector shows the lab's NAT target and
   firewall rules, with three ways to set them: **House preset** (default: allow all in,
   allow all out, default drop), **From SETUP.md…** (paste or point at the firewall table a
   lab guide's `SETUP.md` carries and it becomes rules), or **Custom…** (edit rules by hand).
5. **Save**, then **Plan**. Terraform output streams into the console; the status bar
   shows `Plan: N to add, 0 to change, 0 to destroy`.
6. **Apply…** opens a confirmation. Type the slug to build. VMs are created powered off;
   **Power on** appears once the lab exists. **Destroy…** removes the vApp, also gated by
   typing the slug.

Canvas controls: left-drag pans, wheel zooms, **right-drag draws a selection box**
(Shift adds to it), Delete or the inspector's button removes the selection.

Saved labs live in `labs/<slug>/` (`lab.yaml`, `layout.json`, a `terraform/` folder with
that lab's state). Commit `lab.yaml` and `layout.json`; state files are gitignored.

## Standalone use from the command line

Lab Builder does not depend on any other repo or on Claude Code. After
`scripts/setup.sh`, install the command once:

```bash
bin/lab-builder install        # symlinks lab-builder into ~/.local/bin
```

Then, from anywhere:

```bash
lab-builder ui                 # start the designer and open it in your browser
lab-builder new demo           # scaffold labs/demo/lab.yaml with the gateway pattern, edit by hand
lab-builder plan demo          # terraform plan, read-only
lab-builder build demo         # apply the reviewed plan; asks you to type the slug
lab-builder power demo on      # or off
lab-builder status demo        # live vApp state from vCloud Director
lab-builder destroy demo       # delete the vApp; asks you to type the slug
lab-builder list               # labs on disk and whether they are built
lab-builder vapps              # every vApp in the VDC
```

`PORT=9000 lab-builder ui` picks another port. The lower-level wrappers are still
there: `scripts/tf.sh --lab <slug> …` is `terraform -chdir=…` with `.env` loaded,
`scripts/vapp-power.sh` drives the one imported vApp in `terraform/`, and
`scripts/inventory.py vapp|netconfig <name>` shows any vApp's VMs, NICs, NAT and
firewall. `scripts/catalog_match.py "Ubuntu 24.04 server"` maps a phrase to an image.

## Plan a lab from a lab guide (Claude Code skill)

`/lab-plan <path-to-lab-guide>` reads a guide's `environment.md` and `SETUP.md`,
matches each host to a golden image, lays out the networks the house way, writes
`labs/<slug>/lab.yaml` and a readable `PLAN.md`, runs `terraform plan`, and stops.
`labs/broken-path/` is a worked example. The guide format is the one produced by the
`/lab` skill in the learning-path pipeline; any Markdown with a device table
(host, OS, addresses, role) works with light editing.

### From the learning-path pipeline

The [learning-path-pipeline](https://github.com/willrobertson23wwt/learning-path-pipeline)
carries a `/lab-build <lab-slug>` skill that does the same from inside a course repo:
it reads the lab drafted by `/lab`, writes `labs/<slug>/lab.yaml` and `PLAN.md` here,
runs the plan, and stops. It finds this repo through the installed `lab-builder`
command or `LAB_BUILDER_ROOT`.

## lab.yaml in one screen

```yaml
vapp_name: lab-example
networks:
  Gateway:    {routed: true, cidr: 192.168.2.0/30, gateway: 192.168.2.1, pool: [192.168.2.2, 192.168.2.2]}
  Lab:        {cidr: 192.168.10.0/24, gateway: 192.168.10.1}
vms:
  gateway:
    template: labs-ubuntu2404-server-latest
    nics: [{net: Gateway, mode: POOL}, {net: Lab, mode: DHCP}]
  client01:
    template: labs-ubuntu2404-server-latest
    cpus: 2
    memory: 4096
    nics: [{net: Lab, ip: 192.168.10.42}]
edge_nat: {mode: ip_translation, vm: gateway}
edge_firewall:
  default_action: drop
  rules:
    - {name: Allow portal SSH in, protocol: tcp, source_ip: external,
       destination_vm: gateway, destination_vm_ip_type: NAT, destination_port: "22"}
```

Full schema: [`labs/README.md`](labs/README.md). Design notes and the discovered
environment facts: [`DESIGN.md`](DESIGN.md).

## Layout

| path | what |
|---|---|
| `web/` | the designer (Vite + React + React Flow); `npm run build` -> `web/dist` |
| `server/app.py` | local FastAPI service: vCD proxies, lab save/validate, Terraform jobs |
| `terraform/modules/lab-vapp` | the vApp module driven by `lab.yaml` |
| `terraform/lab-root` | per-lab Terraform root, copied into `labs/<slug>/terraform/` |
| `terraform/` | power control of one pre-existing, imported vApp |
| `bin/lab-builder` | the command line entry point (ui, new, plan, build, power, destroy, …) |
| `scripts/` | `setup.sh`, `ui.sh`, `tf.sh`, `vapp-power.sh`, `setup_rules.py`, read-only vCD helpers |
| `labs/` | your labs |
| `.claude/skills/lab-plan` | the planner skill |

## Security notes

- The service binds to `127.0.0.1` only and has no authentication. Do not expose it.
- `.env` holds your vCD password (or token). It is gitignored; `setup.sh` sets mode 600.
  Prefer an API token where your org allows it.
- Apply and Destroy require typing the lab name. Apply uses the saved plan file, so a
  change made after Plan forces a new Plan.
- Terraform state (`labs/*/terraform/terraform.tfstate`) is local and gitignored. A
  clone on another machine will not know about labs built here.

## Troubleshooting

- **Login fails**: `python3 scripts/discover.py` prints the HTTP error. 401 means wrong
  user/password/org; a TLS error means set `VCD_ALLOW_UNVERIFIED_SSL=true`.
- **Plan wants to replace a vApp you imported**: the resource must declare `org` and
  `vdc` (see `terraform/vapp.tf`).
- **Template not found**: the catalog in `.env` doesn't hold that name; run
  `inventory.py catalogs` and pick from the list.
- **UI shows an old build**: `cd web && npm run build`, then restart `scripts/ui.sh`.
- **`terraform: command not found`** after setup: add `~/.local/bin` to your PATH.

## License

[MIT](LICENSE).

"""Local service behind the lab designer.

Holds the vCD credentials (from ../.env), proxies read-only vCD queries, writes
labs/<slug>/lab.yaml from the canvas, and runs terraform plan / apply / destroy
as background jobs. Runs only on this machine; never expose it.

    scripts/ui.sh            # http://127.0.0.1:8765
"""
import json, os, re, shutil, subprocess, sys, threading, time, urllib.parse, uuid
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from typing import Optional
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from discover import load_env, bearer, get  # noqa: E402
from setup_rules import parse_setup_table, extract_table  # noqa: E402

load_env()
LABS = ROOT / "labs"
LAB_ROOT = ROOT / "terraform" / "lab-root"
TF = shutil.which("terraform") or str(Path.home() / ".local/bin/terraform")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
CATALOG = os.environ.get("VCD_CATALOG", "")          # set in .env
ORG_NETWORK = os.environ.get("TF_VAR_org_network", "")  # set in .env

app = FastAPI(title="lab-designer service")

# ---------------------------------------------------------------- vCD helpers
_tok = {"value": None, "at": 0}

def token():
    if not _tok["value"] or time.time() - _tok["at"] > 20 * 60:
        _tok["value"], _tok["at"] = bearer(), time.time()
    return _tok["value"]

def query(qtype, flt=""):
    f = f"&filter={urllib.parse.quote(flt)}" if flt else ""
    return get(f"/api/query?type={qtype}&format=records&pageSize=128{f}",
               token(), "application/*+json").get("record", [])

_catalog_cache = {"at": 0, "data": None}

@app.get("/api/config")
def config():
    """Site defaults the UI needs (no secrets)."""
    return {"catalog": CATALOG, "org_network": ORG_NETWORK, "org": os.environ.get("VCD_ORG"),
            "vdc": os.environ.get("TF_VAR_vdc"), "url": os.environ.get("VCD_URL")}

@app.get("/api/catalog")
def catalog():
    """Gold-master templates with the VM inside each (OS, sizing, NIC count)."""
    if _catalog_cache["data"] and time.time() - _catalog_cache["at"] < 600:
        return _catalog_cache["data"]
    tpls = {t["name"]: {"name": t["name"], "created": str(t.get("creationDate", ""))[:10], "vms": []}
            for t in query("vAppTemplate", f"catalogName=={CATALOG}")}
    for vm in query("vm", f"isVAppTemplate==true;catalogName=={CATALOG}"):
        t = tpls.get(vm.get("containerName"))
        if t:
            t["vms"].append({"name": vm["name"], "os": vm.get("guestOs", ""),
                             "cpus": vm.get("numberOfCpus"), "memory": vm.get("memoryMB")})
    data = sorted(tpls.values(), key=lambda t: t["name"].lower())
    _catalog_cache.update(at=time.time(), data=data)
    return data

@app.get("/api/vapps")
def vapps():
    return [{"name": r["name"], "status": r.get("status"), "vdc": r.get("vdcName")}
            for r in query("vApp")]

@app.get("/api/networks")
def networks():
    return [{"name": n["name"], "gateway": n.get("defaultGateway"), "netmask": n.get("netmask")}
            for n in query("orgVdcNetwork")]

def _path(href):
    u = urllib.parse.urlparse(href)
    return u.path

def _mask_to_prefix(mask):
    try:
        return sum(bin(int(o)).count("1") for o in mask.split("."))
    except Exception:
        return 24

def _network_of(gw, prefix):
    import ipaddress
    try:
        return str(ipaddress.ip_network(f"{gw}/{prefix}", strict=False))
    except Exception:
        return f"{gw}/{prefix}"

@app.get("/api/vapps/{name}/lab")
def vapp_as_lab(name):
    """Read an existing vApp into the lab.yaml shape so the canvas can show it."""
    recs = query("vApp", f"name=={name}")
    if not recs:
        raise HTTPException(404, "no such vApp")
    v = recs[0]
    tok = token()
    cfg = get(_path(v["href"]) + "/networkConfigSection", tok, "application/*+json")
    networks = {}
    for nc in cfg.get("networkConfig", []):
        c = nc.get("configuration") or {}
        sc = ((c.get("ipScopes") or {}).get("ipScope") or [{}])[0]
        prefix = _mask_to_prefix(sc.get("netmask") or "255.255.255.0")
        net = {"cidr": _network_of(sc.get("gateway"), prefix), "gateway": sc.get("gateway")}
        if c.get("fenceMode") == "natRouted":
            net["routed"] = True
        rng = ((sc.get("ipRanges") or {}).get("ipRange") or [])
        if rng:
            net["pool"] = [rng[0]["startAddress"], rng[0]["endAddress"]]
        if sc.get("dns1"):
            net["dns"] = sc["dns1"]
        networks[nc["networkName"]] = net
    vms = {}
    for vm in query("vm", f"container=={v['href']}"):
        d = get(_path(vm["href"]) + "/networkConnectionSection", tok, "application/*+json")
        nics = []
        for nc in sorted(d.get("networkConnection", []), key=lambda n: n.get("networkConnectionIndex", 0)):
            nic = {"net": nc.get("network")}
            mode = nc.get("ipAddressAllocationMode", "DHCP")
            if mode == "MANUAL" and nc.get("ipAddress"):
                nic["ip"] = nc["ipAddress"]
            else:
                nic["mode"] = mode
                if nc.get("ipAddress"):
                    nic["ip"] = nc["ipAddress"]
            if nc.get("network") not in networks:
                nic["net"] = nc.get("network") or "none"
            nics.append(nic)
        vms[vm["name"]] = {"template": "", "existing": True, "os": vm.get("guestOs", ""),
                           "cpus": vm.get("numberOfCpus"), "memory": vm.get("memoryMB"),
                           "status": vm.get("status"), "nics": nics}
    return {"vapp_name": v["name"], "vapp_status": v.get("status"), "vapp_href": v["href"],
            "lab": {"vapp_name": v["name"], "description": "", "networks": networks, "vms": vms}}

class PowerBody(BaseModel):
    power_on: bool = False

def run_py_job(slug, kind, fn):
    jid = uuid.uuid4().hex[:8]
    job = {"id": jid, "slug": slug, "kind": kind, "status": "running", "output": "",
           "started": time.time(), "finished": None, "rc": None}
    JOBS[jid] = job
    def work():
        try:
            for line in fn():
                job["output"] += line + "\n"
            job["rc"] = 0; job["status"] = "ok"
        except Exception as e:
            job["output"] += f"ERROR: {e}\n"; job["rc"] = 1; job["status"] = "failed"
        job["finished"] = time.time()
    threading.Thread(target=work, daemon=True).start()
    return job

def _vcd_post(path, body, ctype):
    import ssl, urllib.request
    from discover import base, ctx
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(f"{base()}{path}", data=data, method="POST", headers={
        "Accept": "application/*+json;version=39.0", "Authorization": f"Bearer {token()}",
        **({"Content-Type": f"{ctype};version=39.0"} if ctype else {})})
    with urllib.request.urlopen(req, context=ctx(), timeout=60) as r:
        return json.load(r)

@app.post("/api/vapps/{name}/power")
def vapp_power(name, body: PowerBody):
    """Power an existing vApp on, or undeploy (power off) it, via the vCD REST API."""
    recs = query("vApp", f"name=={name}")
    if not recs:
        raise HTTPException(404, "no such vApp")
    href = _path(recs[0]["href"])
    def steps():
        if body.power_on:
            yield f"POST {href}/power/action/powerOn"
            task = _vcd_post(f"{href}/power/action/powerOn", None, None)
        else:
            yield f"POST {href}/action/undeploy (powerOff)"
            task = _vcd_post(f"{href}/action/undeploy", {"undeployPowerAction": "powerOff"},
                             "application/vnd.vmware.vcloud.undeployVAppParams+json")
        thref = _path(task["href"])
        for _ in range(120):
            t = get(thref, token(), "application/*+json")
            st = t.get("status")
            yield f"task {st} {t.get('progress', '') or ''}".rstrip()
            if st in ("success", "error", "canceled", "aborted"):
                if st != "success":
                    raise RuntimeError(t.get("details") or st)
                return
            time.sleep(3)
        raise RuntimeError("timed out waiting for the vCD task")
    with _lock:
        if busy(name):
            raise HTTPException(409, "a job is already running for this vApp")
        return run_py_job(name, "power", steps)

# ------------------------------------------------------------------- labs
def lab_dir(slug):
    if not SLUG_RE.match(slug or ""):
        raise HTTPException(400, "slug must be lowercase letters, digits and dashes")
    return LABS / slug

def tf_dir(slug):
    return lab_dir(slug) / "terraform"

def lab_state(slug):
    """What terraform knows about this lab, without calling vCD."""
    st = tf_dir(slug) / "terraform.tfstate"
    built = False
    if st.exists():
        try:
            built = bool(json.loads(st.read_text()).get("resources"))
        except Exception:
            built = False
    return {"built": built, "planned": (tf_dir(slug) / "tfplan").exists()}

@app.get("/api/labs")
def list_labs():
    out = []
    if LABS.exists():
        for d in sorted(LABS.iterdir()):
            if (d / "lab.yaml").exists():
                y = yaml.safe_load((d / "lab.yaml").read_text()) or {}
                out.append({"slug": d.name, "vapp_name": y.get("vapp_name"), **lab_state(d.name)})
    return out

@app.get("/api/labs/{slug}")
def read_lab(slug):
    d = lab_dir(slug)
    if not (d / "lab.yaml").exists():
        raise HTTPException(404, "no such lab")
    lab = yaml.safe_load((d / "lab.yaml").read_text()) or {}
    layout = json.loads((d / "layout.json").read_text()) if (d / "layout.json").exists() else None
    plan_md = (d / "PLAN.md").read_text() if (d / "PLAN.md").exists() else ""
    status = None
    try:
        recs = query("vApp", f"name=={lab.get('vapp_name')}") if lab.get("vapp_name") else []
        status = recs[0]["status"] if recs else "NOT_IN_VCD"
    except Exception as e:  # vCD unreachable should not break loading
        status = f"unknown ({e})"
    return {"slug": slug, "lab": lab, "layout": layout, "plan_md": plan_md,
            "vapp_status": status, **lab_state(slug)}

class SaveBody(BaseModel):
    lab: dict
    layout: Optional[dict] = None

def validate_lab(lab):
    if not lab.get("vapp_name"):
        raise HTTPException(400, "vapp_name is required")
    nets = lab.get("networks") or {}
    vms = lab.get("vms") or {}
    if not nets or not vms:
        raise HTTPException(400, "need at least one network and one VM")
    routed = [n for n, v in nets.items() if v.get("routed")]
    if len(routed) != 1:
        raise HTTPException(400, f"exactly one network must be routed (found {len(routed)})")
    for name, vm in vms.items():
        if not vm.get("template"):
            raise HTTPException(400, f"VM {name} has no template")
        if not vm.get("nics"):
            raise HTTPException(400, f"VM {name} has no NICs; connect it to a network")
        for nic in vm["nics"]:
            if nic.get("net") not in nets:
                raise HTTPException(400, f"VM {name} NIC references unknown network {nic.get('net')}")
    nat = lab.get("edge_nat")
    if nat and nat.get("mode") == "ip_translation" and nat.get("vm") not in vms:
        raise HTTPException(400, "edge_nat.vm must name a VM")

@app.put("/api/labs/{slug}")
def save_lab(slug, body: SaveBody):
    validate_lab(body.lab)
    d = lab_dir(slug); d.mkdir(parents=True, exist_ok=True)
    (d / "lab.yaml").write_text(
        f"# Written by the lab designer {time.strftime('%Y-%m-%d %H:%M')}\n"
        + yaml.safe_dump(body.lab, sort_keys=False, default_flow_style=None, width=120))
    if body.layout is not None:
        (d / "layout.json").write_text(json.dumps(body.layout, indent=1))
    if not tf_dir(slug).exists():
        shutil.copytree(LAB_ROOT, tf_dir(slug), ignore=shutil.ignore_patterns(".terraform*", "*.tfstate*", "tfplan"))
    # A saved change invalidates any earlier reviewed plan.
    (tf_dir(slug) / "tfplan").unlink(missing_ok=True)
    return {"ok": True, **lab_state(slug)}

@app.delete("/api/labs/{slug}")
def delete_lab(slug, confirm: str = ""):
    """Remove the lab folder. Refused while the vApp is built."""
    if confirm != slug:
        raise HTTPException(400, "confirm must equal the slug")
    if lab_state(slug)["built"]:
        raise HTTPException(409, "destroy the vApp first")
    shutil.rmtree(lab_dir(slug), ignore_errors=True)
    return {"ok": True}

class SetupBody(BaseModel):
    text: Optional[str] = None      # pasted markdown (the table or the whole SETUP.md)
    path: Optional[str] = None      # or a local path to SETUP.md
    gateway: str = "gateway"
    vm_names: list = []

@app.post("/api/rules/parse-setup")
def parse_setup(body: SetupBody):
    """Turn a /lab-skill SETUP.md firewall table into edge_firewall rules."""
    md = body.text or ""
    if body.path:
        pth = Path(body.path).expanduser()
        if not pth.exists():
            raise HTTPException(404, f"no such file: {pth}")
        md = pth.read_text()
    if not md.strip():
        raise HTTPException(400, "paste the table or give a path")
    return parse_setup_table(extract_table(md), gateway=body.gateway, vm_names=body.vm_names)

# ------------------------------------------------------------------- jobs
JOBS = {}
_lock = threading.Lock()

def env():
    e = os.environ.copy()
    e["TF_IN_AUTOMATION"] = "1"
    return e

def run_job(slug, kind, argv_list):
    jid = uuid.uuid4().hex[:8]
    job = {"id": jid, "slug": slug, "kind": kind, "status": "running", "output": "",
           "started": time.time(), "finished": None, "rc": None}
    JOBS[jid] = job

    def work():
        for argv in argv_list:
            job["output"] += f"$ terraform {' '.join(argv)}\n"
            p = subprocess.Popen([TF, f"-chdir={tf_dir(slug)}", *argv], env=env(),
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in p.stdout:
                job["output"] += line
            p.wait()
            job["rc"] = p.returncode
            if p.returncode != 0:
                break
        job["status"] = "ok" if job["rc"] == 0 else "failed"
        job["finished"] = time.time()
    threading.Thread(target=work, daemon=True).start()
    return job

def busy(slug):
    return any(j["slug"] == slug and j["status"] == "running" for j in JOBS.values())

def start(slug, kind, argv_list):
    with _lock:
        if busy(slug):
            raise HTTPException(409, "a job is already running for this lab")
        if not tf_dir(slug).exists():
            raise HTTPException(404, "lab has no terraform root; save it first")
        return run_job(slug, kind, argv_list)

class Confirm(BaseModel):
    confirm: str = ""
    power_on: bool = False

@app.post("/api/labs/{slug}/plan")
def plan(slug, body: Optional[Confirm] = None):
    power = "true" if (body and body.power_on) else "false"
    return start(slug, "plan", [
        ["init", "-input=false", "-no-color"],
        ["plan", "-input=false", "-no-color", f"-var=power_on={power}", "-out=tfplan"],
    ])

@app.post("/api/labs/{slug}/apply")
def apply(slug, body: Confirm):
    """Applies exactly the saved plan file, so what was reviewed is what runs."""
    if body.confirm != slug:
        raise HTTPException(400, "type the lab slug to confirm")
    if not (tf_dir(slug) / "tfplan").exists():
        raise HTTPException(409, "no reviewed plan; run plan first")
    return start(slug, "apply", [["apply", "-input=false", "-no-color", "tfplan"]])

@app.post("/api/labs/{slug}/power")
def power(slug, body: Confirm):
    if not lab_state(slug)["built"]:
        raise HTTPException(409, "lab is not built")
    return start(slug, "power", [["apply", "-input=false", "-no-color", "-auto-approve",
                                  f"-var=power_on={'true' if body.power_on else 'false'}"]])

@app.post("/api/labs/{slug}/destroy")
def destroy(slug, body: Confirm):
    if body.confirm != slug:
        raise HTTPException(400, "type the lab slug to confirm")
    (tf_dir(slug) / "tfplan").unlink(missing_ok=True)
    return start(slug, "destroy", [["destroy", "-input=false", "-no-color", "-auto-approve"]])

@app.get("/api/jobs/{jid}")
def job(jid):
    j = JOBS.get(jid)
    if not j:
        raise HTTPException(404, "no such job")
    return j

@app.get("/api/labs/{slug}/output")
def tf_output(slug):
    if not lab_state(slug)["built"]:
        return {}
    r = subprocess.run([TF, f"-chdir={tf_dir(slug)}", "output", "-json", "-no-color"],
                       env=env(), capture_output=True, text=True)
    try:
        return {k: v.get("value") for k, v in json.loads(r.stdout or "{}").items()}
    except Exception:
        return {"error": r.stderr[-500:]}

# ------------------------------------------------------------- static UI
DIST = ROOT / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(DIST / "index.html")

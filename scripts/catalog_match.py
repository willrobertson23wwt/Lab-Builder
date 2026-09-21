#!/usr/bin/env python3
"""Match a lab guide's device description to an atc-gold-masters template.

  scripts/catalog_match.py "Ubuntu 24.04 server" "Windows 11 desktop" "Cisco IOS-XE router"
  scripts/catalog_match.py --json ...      # machine-readable
  scripts/catalog_match.py --list          # dump the live catalog

Matching is rule-based on OS family/version/role words, then confirmed
against the LIVE catalog so a renamed or missing template is reported as
such instead of guessed. Exit 0 always; unmatched entries say so.
"""
import json, re, sys, urllib.parse
from discover import load_env, bearer, get

import os
CATALOG = ""  # resolved from VCD_CATALOG in .env inside main()

# (regex on the normalised description, template name, note)
RULES = [
    (r"ubuntu.*24\.?04.*(desk|gui|workstation|xrdp)", "labs-ubuntu2404-desk-latest", "Ubuntu 24.04 with desktop"),
    (r"ubuntu.*24\.?04", "labs-ubuntu2404-server-latest", "Ubuntu 24.04 server (1 NIC, 32 GB disk, 2 vCPU/1 GB)"),
    (r"ubuntu.*22\.?04.*(desk|gui|workstation|xrdp)", "labs-ubuntu2204-desk-latest", "Ubuntu 22.04 with desktop"),
    (r"ubuntu.*22\.?04", "labs-ubuntu2204-server-latest", "Ubuntu 22.04 server"),
    (r"ubuntu(?!.*(24|22)\.?04)", "labs-ubuntu2404-server-latest", "Ubuntu, version unspecified: newest LTS server"),
    (r"(centos|rhel|red ?hat|rocky|alma).*(desk|gui|workstation)", "labs-centos8-desk-latest", "CentOS 8 desktop (closest RHEL-family image)"),
    (r"centos|rhel|red ?hat|rocky|alma", "labs-centos8-serv-latest", "CentOS 8 server (closest RHEL-family image)"),
    (r"windows.*(11|10)|win ?(11|10)", "labs-win11-latest", "Windows 11 desktop"),
    (r"windows.*server.*(2022|2k22)|win2k22", "labs-win2k22-latest", "Windows Server 2022"),
    (r"windows.*server.*(2019|2k19)|win2k19", "labs-win2k19-latest", "Windows Server 2019"),
    (r"windows.*server.*(2016|2k16)|win2k16", "labs-win2k16-latest", "Windows Server 2016"),
    (r"windows.*server", "labs-win2k22-latest", "Windows Server, version unspecified: 2022"),
    (r"csr|ios[- ]?xe|cisco.*router|cisco.*ios", "labs-csr-latest", "Cisco CSR1000v (8 NICs; admin creds in template description)"),
    (r"vyos", "vyos-1.1.7", "VyOS 1.1.7 router (vyos/vyos)"),
    (r"esxi|vsphere|vcenter", "vsphere8-gold", "vSphere 8 (ESXi + vCenter + Win jumpbox)"),
    (r"palo ?alto|pan-?os|ngfw", "pangfw-found-10", "Palo Alto foundation lab (large multi-VM template)"),
]

def normalise(s):
    return re.sub(r"\s+", " ", s.lower().replace("-", " ").replace("_", " ")).strip()

def live_catalog(tok):
    flt = urllib.parse.quote(f"catalogName=={CATALOG}")
    recs = get(f"/api/query?type=vAppTemplate&format=records&pageSize=128&filter={flt}",
               tok, "application/*+json").get("record", [])
    return {r["name"]: r for r in recs}

def match(desc, catalog):
    n = normalise(desc)
    for pat, tpl, note in RULES:
        if re.search(pat, n):
            if tpl in catalog:
                return {"input": desc, "template": tpl, "catalog": CATALOG, "note": note, "found": True}
            return {"input": desc, "template": tpl, "catalog": CATALOG, "found": False,
                    "note": f"rule matched {tpl} but it is not in {CATALOG} right now"}
    return {"input": desc, "template": None, "catalog": CATALOG, "found": False,
            "note": "no rule matched; pick from --list or build the image by hand"}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv
    global CATALOG
    load_env(); CATALOG = os.environ.get("VCD_CATALOG", "")
    if not CATALOG:
        sys.exit("VCD_CATALOG is not set in .env (see scripts/inventory.py catalogs)")
    tok = bearer(); cat = live_catalog(tok)
    if "--list" in sys.argv or not args:
        for name in sorted(cat, key=str.lower):
            print(name)
        return
    results = [match(a, cat) for a in args]
    if as_json:
        print(json.dumps(results, indent=2)); return
    for r in results:
        mark = "OK " if r["found"] else "-- "
        print(f"{mark}{r['input']!r:<40} -> {r['template'] or 'NO MATCH':<32} {r['note']}")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""List Org VDCs and vApps visible to the API token in .env.

Standard library only. Exchanges the API token for a bearer token, then
queries CloudAPI for VDCs and the legacy query service for vApps.

  scripts/discover.py            # VDCs and all vApps
  scripts/discover.py --vapp X   # one vApp's status
"""
import argparse, json, os, ssl, sys, urllib.parse, urllib.request
from pathlib import Path

API_VERSION = "39.0"

def load_env():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

def ctx():
    c = ssl.create_default_context()
    if os.environ.get("VCD_ALLOW_UNVERIFIED_SSL", "false").lower() == "true":
        c.check_hostname = False
        c.verify_mode = ssl.CERT_NONE
    return c

def base():
    url = os.environ["VCD_URL"].rstrip("/")
    return url[:-4] if url.endswith("/api") else url

def bearer():
    """Return a bearer token using whichever credential .env provides."""
    org = os.environ["VCD_ORG"]
    if os.environ.get("VCD_API_TOKEN"):
        data = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": os.environ["VCD_API_TOKEN"],
        }).encode()
        req = urllib.request.Request(
            f"{base()}/oauth/tenant/{org}/token", data=data, method="POST",
            headers={"Accept": "application/json",
                     "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, context=ctx(), timeout=30) as r:
            return json.load(r)["access_token"]
    # Integrated (local/LDAP) auth: Basic user@org:password to the sessions
    # endpoint; the bearer token comes back in a response header.
    import base64
    cred = f"{os.environ['VCD_USER']}@{org}:{os.environ['VCD_PASSWORD']}"
    req = urllib.request.Request(
        f"{base()}/cloudapi/1.0.0/sessions", data=b"", method="POST",
        headers={"Accept": f"application/json;version={API_VERSION}",
                 "Authorization": "Basic " + base64.b64encode(cred.encode()).decode()})
    with urllib.request.urlopen(req, context=ctx(), timeout=30) as r:
        tok = r.headers.get("X-VMWARE-VCLOUD-ACCESS-TOKEN")
    if not tok:
        sys.exit("Login succeeded but no access token header was returned.")
    return tok

def get(path, token, accept):
    req = urllib.request.Request(f"{base()}{path}", headers={
        "Accept": f"{accept};version={API_VERSION}",
        "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, context=ctx(), timeout=60) as r:
        return json.load(r)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vapp", help="show only this vApp")
    args = ap.parse_args()
    load_env()
    for k in ("VCD_URL", "VCD_ORG"):
        if not os.environ.get(k):
            sys.exit(f"{k} is not set. Fill in .env first.")
    has_token = bool(os.environ.get("VCD_API_TOKEN"))
    has_pw = all(os.environ.get(k) and not os.environ[k].startswith("your-")
                 for k in ("VCD_USER", "VCD_PASSWORD"))
    if not (has_token or has_pw):
        sys.exit("Set VCD_USER and VCD_PASSWORD (or VCD_API_TOKEN) in .env first.")
    tok = bearer()

    if not args.vapp:
        vdcs = get("/cloudapi/1.0.0/vdcs?pageSize=50", tok, "application/json")
        print("Org VDCs:")
        for v in vdcs.get("values", []):
            print(f"  {v['name']}   (id {v['id']})")
        print()

    flt = f"&filter=name=={urllib.parse.quote(args.vapp)}" if args.vapp else ""
    q = get(f"/api/query?type=vApp&format=records&pageSize=128{flt}", tok,
            "application/*+json")
    recs = q.get("record", [])
    if not recs:
        sys.exit("No vApps matched." if args.vapp else "No vApps visible.")
    print(f"{'vApp':<32} {'VDC':<28} {'Status':<14} {'VMs':>3}")
    for r in recs:
        print(f"{r['name']:<32} {r.get('vdcName',''):<28} "
              f"{r.get('status',''):<14} {r.get('numberOfVMs',''):>3}")

if __name__ == "__main__":
    main()

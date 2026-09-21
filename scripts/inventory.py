#!/usr/bin/env python3
"""Read-only inventory of what the account can build with.

  scripts/inventory.py catalogs            # catalogs and their vApp templates
  scripts/inventory.py networks            # org VDC networks and edge gateways
  scripts/inventory.py vapp <name>         # VMs, NICs and networks of one vApp
  scripts/inventory.py netconfig <name>    # fence mode, NAT and firewall per vApp network
"""
import json, sys, urllib.parse
from discover import load_env, bearer, get

def q(tok, qtype, flt="", page_size=128):
    f = f"&filter={urllib.parse.quote(flt)}" if flt else ""
    return get(f"/api/query?type={qtype}&format=records&pageSize={page_size}{f}",
               tok, "application/*+json").get("record", [])

def path_of(href):
    """Strip scheme and host so discover.get() can prepend the base URL."""
    u = urllib.parse.urlparse(href)
    return u.path + (f"?{u.query}" if u.query else "")

def netconfig(tok, name):
    """Fence mode, parent org network, NAT and firewall rules per vApp network."""
    recs = q(tok, "vApp", f"name=={name}")
    if not recs:
        sys.exit(f"vApp {name} not found")
    vms = {vm['href'].rsplit('/', 1)[-1]: vm['name'] for vm in q(tok, "vm", f"containerName=={name}")}
    d = get(path_of(recs[0]['href']) + "/networkConfigSection", tok, "application/*+json")
    for nc in d.get("networkConfig", []):
        cfg = nc.get("configuration") or {}
        parent = (cfg.get("parentNetwork") or {}).get("name")
        scopes = (cfg.get("ipScopes") or {}).get("ipScope") or [{}]
        sc = scopes[0]
        feats = cfg.get("features") or {}
        dhcp = (feats.get("dhcpService") or {}).get("isEnabled")
        print(f"\n[{nc['networkName']}] fence={cfg.get('fenceMode')} parent={parent} "
              f"gw={sc.get('gateway')}/{sc.get('netmask')} dns={sc.get('dns1')} dhcp={dhcp}")
        ranges = (sc.get("ipRanges") or {}).get("ipRange") or []
        if ranges:
            print("  static pool:", ", ".join(f"{r['startAddress']}-{r['endAddress']}" for r in ranges))
        rn = cfg.get("routerInfo") or {}
        if rn.get("externalIp"):
            print(f"  vApp edge external IP: {rn['externalIp']}")
        fw = feats.get("firewallService") or {}
        if fw:
            print(f"  firewall enabled={fw.get('isEnabled')} default={fw.get('defaultAction')} logDefault={fw.get('logDefaultAction')}")
            for r in fw.get("firewallRule") or []:
                protos = [k for k, v in (r.get("protocols") or {}).items() if v]
                print(f"    {str(r.get('policy')):<5} {str(r.get('description',''))[:36]:<36} "
                      f"proto={','.join(protos):<12} src={r.get('sourceIp')}:{r.get('sourcePortRange')} "
                      f"dst={r.get('destinationIp')}:{r.get('destinationPortRange')} on={r.get('isEnabled')}")
        nat = feats.get("natService") or {}
        if nat:
            print(f"  nat enabled={nat.get('isEnabled')} type={nat.get('natType')} policy={nat.get('policy')}")
            for r in nat.get("natRule") or []:
                pf = r.get("vmRule") or {}
                vmname = vms.get(pf.get("vAppScopedVmId", ""), pf.get("vAppScopedVmId", ""))
                print(f"    {pf.get('protocol','?'):<4} ext:{pf.get('externalPort'):<6} -> {vmname} nic{pf.get('vmNicId')} :{pf.get('internalPort')}")

def catalogs(tok):
    for c in q(tok, "catalog"):
        print(f"\nCatalog: {c['name']}  (shared={c.get('isShared')}, published={c.get('isPublished')})")
        items = q(tok, "vAppTemplate", f"catalogName=={c['name']}")
        for t in sorted(items, key=lambda r: r['name'].lower()):
            print(f"  {t['name']:<45} vms={t.get('numberOfVMs','?'):<3} "
                  f"created={str(t.get('creationDate',''))[:10]}")
        if not items:
            print("  (no vApp templates)")

def networks(tok):
    print("Org VDC networks:")
    for n in q(tok, "orgVdcNetwork"):
        print(f"  {n['name']:<40} type={n.get('linkType','?'):<10} "
              f"gw={n.get('defaultGateway','')}/{n.get('netmask','')} "
              f"dns={n.get('dns1','')} shared={n.get('isShared')}")
    print("\nEdge gateways:")
    for e in q(tok, "edgeGateway"):
        print(f"  {e['name']:<40} status={e.get('gatewayStatus','')} "
              f"ext_nets={e.get('numberOfExtNetworks','')} org_nets={e.get('numberOfOrgNetworks','')}")

def vapp(tok, name):
    recs = q(tok, "vApp", f"name=={name}")
    if not recs:
        sys.exit(f"vApp {name} not found")
    v = recs[0]
    print(f"vApp {v['name']}  status={v['status']}  href={v['href']}")
    print("\nvApp networks:")
    for n in q(tok, "vAppNetwork", f"vAppName=={name}"):
        print(f"  {n['name']:<32} gw={n.get('gateway','')}/{n.get('netmask','')} "
              f"parent={n.get('linkNetworkName','')} fence={n.get('isBusy','')}")
    print("\nVMs:")
    for vm in q(tok, "vm", f"containerName=={name}"):
        print(f"  {vm['name']:<28} status={vm.get('status',''):<12} "
              f"os={vm.get('guestOs','')[:28]:<28} cpu={vm.get('numberOfCpus','')} "
              f"memMB={vm.get('memoryMB','')} net={vm.get('networkName','')} "
              f"ip={vm.get('ipAddress','')}")
        # detail: every NIC
        d = get(path_of(vm['href']) + "/networkConnectionSection", tok, "application/*+json")
        for nc in d.get("networkConnection", []):
            print(f"      nic{nc.get('networkConnectionIndex')} net={nc.get('network'):<24} "
                  f"mode={nc.get('ipAddressAllocationMode'):<8} ip={nc.get('ipAddress','')} "
                  f"connected={nc.get('isConnected')}")

if __name__ == "__main__":
    load_env(); tok = bearer()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "catalogs"
    if cmd == "catalogs": catalogs(tok)
    elif cmd == "networks": networks(tok)
    elif cmd == "vapp" and len(sys.argv) > 2: vapp(tok, sys.argv[2])
    elif cmd == "netconfig" and len(sys.argv) > 2: netconfig(tok, sys.argv[2])
    else: sys.exit(__doc__)

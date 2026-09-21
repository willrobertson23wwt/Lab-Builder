#!/usr/bin/env python3
"""Turn the "vApp edge firewall" table of a lab's SETUP.md (written by the /lab
skill) into lab.yaml edge_firewall rules.

  scripts/setup_rules.py path/to/SETUP.md [--gateway gateway] [--yaml]
  cat table.md | scripts/setup_rules.py - --gateway gw

Table shape (one row per rule, last row "Default policy"):
  | # | Name | Action | Protocol | Source | Destination | Ports |
  | 1 | Allow portal SSH in | Allow | TCP | external : Any | internal : gateway VM only | 22, 2210, 2211 |
  | 2 | Allow ping/trace out | Allow | ICMP + UDP | internal : gateway VM | external : Any | UDP 33434–33534 |
  | 3 | Default policy | Deny | Any | Any : Any | Any : Any | logging **on** |

Mapping: "external"/"internal"/"Any" keywords stay keywords; a destination that
names the gateway/lab VM becomes destination_vm=<gateway> with the NAT address
type (how vCD stores portal-SSH rules); a source that names a VM stays the
"internal" keyword. Combined protocols and port lists expand to one rule each.
Rules whose name says "maintenance" are written disabled.
"""
import json, re, sys

PROTOS = {"tcp": "tcp", "udp": "udp", "icmp": "icmp", "any": "any", "all": "any"}

def _cell(s):
    return re.sub(r"\*\*|`", "", s).strip()

def _split_protos(p):
    parts = [x.strip().lower() for x in re.split(r"[+/,&]| and ", p) if x.strip()]
    out = [PROTOS.get(x, None) for x in parts]
    return [o for o in out if o] or ["any"]

def _parse_ports(cell):
    """-> list of (protocol-or-None, port-or-range). 'any'/blank -> [(None,'any')]."""
    cell = _cell(cell).replace("–", "-").replace("—", "-")
    if not cell or re.search(r"\bany\b|logging", cell, re.I):
        return [(None, "any")]
    items = []
    for raw in re.split(r"[,;]", cell):
        raw = raw.strip()
        if not raw:
            continue
        m = re.match(r"^(tcp|udp|icmp)\s+(.+)$", raw, re.I)
        proto, port = (m.group(1).lower(), m.group(2).strip()) if m else (None, raw)
        port = re.sub(r"\s+", "", port)
        if re.fullmatch(r"\d+(-\d+)?", port):
            items.append((proto, port))
    return items or [(None, "any")]

def _endpoint(cell, gateway, vm_names):
    """-> ('keyword', 'any'|'internal'|'external') or ('vm', name)."""
    c = _cell(cell).lower()
    zone = "any"
    if c.startswith("external"): zone = "external"
    elif c.startswith("internal"): zone = "internal"
    # a named VM after the colon?
    tail = c.split(":", 1)[1] if ":" in c else c
    for name in vm_names:
        if name.lower() in tail:
            return ("vm", name)
    if re.search(r"gateway vm|lab vm|jumpbox|gateway", tail) and gateway:
        return ("vm", gateway)
    return ("keyword", zone)

def parse_setup_table(text, gateway="gateway", vm_names=()):
    rows = [l for l in text.splitlines() if l.strip().startswith("|")]
    header_seen = False
    result = {"default_action": "drop", "log_default_action": True, "rules": [], "notes": []}
    for line in rows:
        cells = [_cell(c) for c in line.strip().strip("|").split("|")]
        if len(cells) < 7:
            continue
        if re.fullmatch(r"-+", cells[0]) or cells[1].lower() == "name":
            header_seen = True
            continue
        num, name, action, proto, src, dst, ports = cells[:7]
        policy = "allow" if action.lower().startswith("allow") else "drop"
        if name.lower().startswith("default"):
            result["default_action"] = policy
            result["log_default_action"] = bool(re.search(r"logging\s*on", ports, re.I))
            continue
        s_kind, s_val = _endpoint(src, gateway, vm_names)
        d_kind, d_val = _endpoint(dst, gateway, vm_names)
        disabled = bool(re.search(r"maintenance", name, re.I))
        port_items = _parse_ports(ports)
        for p in _split_protos(proto):
            my_ports = [pt for pr, pt in port_items if pr in (None, p)] if p != "icmp" else ["any"]
            if p != "icmp" and not my_ports:
                my_ports = ["any"]
            for port in my_ports:
                rule = {"name": name if len(port_items) * len(_split_protos(proto)) == 1 else f"{name} ({p}{' ' + port if port != 'any' else ''})",
                        "policy": policy, "protocol": p}
                if s_kind == "vm":
                    rule["source_ip"] = "internal"      # vCD stores VM sources as the internal zone
                else:
                    rule["source_ip"] = s_val
                if d_kind == "vm":
                    rule["destination_vm"] = d_val
                    rule["destination_vm_ip_type"] = "NAT"
                else:
                    rule["destination_ip"] = d_val
                if port != "any":
                    rule["destination_port"] = str(port)
                if disabled:
                    rule["enabled"] = False
                result["rules"].append(rule)
        if s_kind == "vm":
            result["notes"].append(f"row {num}: source '{src}' written as the internal zone")
        if d_kind == "vm" and d_val == gateway and "gateway" not in dst.lower():
            result["notes"].append(f"row {num}: destination '{dst}' mapped to VM '{gateway}'")
    if not header_seen and not result["rules"]:
        result["notes"].append("no firewall table found")
    return result

def extract_table(md):
    """Return only the 'vApp edge firewall' section's table lines if present."""
    m = re.search(r"^##\s+vApp edge firewall.*?(?=^##\s|\Z)", md, re.S | re.M)
    return m.group(0) if m else md

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    gw = "gateway"
    if "--gateway" in sys.argv:
        gw = sys.argv[sys.argv.index("--gateway") + 1]
    src = sys.stdin.read() if not args or args[0] == "-" else open(args[0]).read()
    res = parse_setup_table(extract_table(src), gateway=gw)
    if "--yaml" in sys.argv:
        import yaml
        print(yaml.safe_dump({"edge_firewall": {k: v for k, v in res.items() if k != "notes"}}, sort_keys=False, default_flow_style=None, width=140))
        for n in res["notes"]: print("#", n)
    else:
        print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()

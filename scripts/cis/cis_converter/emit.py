"""Emit the yq-shaped dict as the site's library files.

`benchmark_to_xml` renders the dict back to XCCDF XML so the committed
`.xml` and `.json` are two views of one source. upload.spec.ts pins the
pair: fast-xml-parser must re-parse the XML to the same shape (modulo
singleton array canonicalization).
"""

from __future__ import annotations

import json
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

from .map import manifest_entry

STIG_SUFFIX = " Security Technical Implementation Guide"

# Technology-class classification for CIS benchmarks, applied by title
# keyword in the same order the CIS download portal groups them.
CATEGORIES = [
    (["Microsoft Azure", "Alibaba Cloud", "Tencent Cloud", "Amazon Web Services",
      "AWS ", "DigitalOcean", "Google Cloud", "Google Workspace", "IBM Cloud",
      "Oracle Cloud", "Snowflake", "Microsoft 365", "Okta", "Entra",
      "Dynamics 365", "Oracle SaaS"],
     "Cloud Providers"),
    (["Intune", "iOS", "iPadOS", "Android"], "Mobile Devices"),
    (["Cisco", "Arista", "Check Point", "Extreme Networks", "F5", "Forti",
      "HPE Aruba", "Juniper", "Palo Alto", "pfSense", "Sophos", "Dragos",
      "Forescout", "Infoblox", "OPNsense"],
     "Network Devices"),
    (["Everpure"], "Storage Device"),
    (["Google Chrome", "Microsoft Edge", "Mozilla Firefox", "Safari",
      "Microsoft Office", "Visual Studio"], "Desktop Software"),
    (["GitHub", "GitLab"], "DevSecOps Tools"),
    (["Microsoft Windows", "Ubuntu", "Red Hat", "Debian", "CentOS", "macOS",
      "AlmaLinux", "Rocky", "Amazon Linux", "Oracle Linux", "SUSE",
      "Linux Mint", "FreeBSD", "Solaris", "IBM AIX", "IBM i", "ChromeOS",
      "Azure Linux", "Bottlerocket", "Talos", "LXD", "Wind River",
      "Distribution Independent", "Robot Operating System",
      "Container-Optimized OS", "Container- Optimized OS",
      "RHEL8 on IBM Z"],
     "Operating Systems"),
    (["Docker", "Kubernetes", "VMware", "Apache", "Tomcat", "NGINX", "IIS",
      "SQL Server", "MySQL", "PostgreSQL", "MongoDB", "Exchange",
      "SharePoint", "WebSphere", "Db2", "BIND", "Cassandra", "CockroachDB",
      "Kerberos", "SingleStore", "OceanBase", "Yugabyte", "MariaDB",
      "CICS", "Oracle Database", "OpenShift", "Tanium", "Xylok",
      "zSecure", "DotNet", "Defender"],
     "Server Software"),
]


def classify(title: str) -> str:
    lowered = title.lower()
    for keywords, category in CATEGORIES:
        for keyword in keywords:
            if keyword.lower() in lowered:
                return category
    return "Other"


def benchmark_to_json(stig: dict) -> str:
    return json.dumps(stig, indent=2, ensure_ascii=False) + "\n"


def benchmark_to_xml(stig: dict) -> str:
    benchmark = stig["Benchmark"]
    parts = ['<?xml version="1.0" encoding="utf-8"?>']
    if "+p_xml-stylesheet" in stig:
        parts.append(f"<?xml-stylesheet {stig['+p_xml-stylesheet']}?>")
    parts.append(_element("Benchmark", benchmark, depth=0))
    parts.append("\n")
    return "".join(parts)


def _element(name: str, value, depth: int) -> str:
    pad = "  " * depth
    if isinstance(value, list):
        return "".join(_element(name, item, depth) for item in value)
    attrs = ""
    text = ""
    children = []
    if isinstance(value, dict):
        for key, val in value.items():
            if key.startswith("+@"):
                attrs += f" {key[2:]}={quoteattr(str(val))}"
            elif key == "+content":
                text = str(val)
            else:
                children.append(_element(key, val, depth + 1))
    else:
        text = "" if value is None else str(value)

    if children:
        inner = "".join(children)
        return f"{pad}<{name}{attrs}>\n{inner}{pad}</{name}>\n"
    if text:
        return f"{pad}<{name}{attrs}>{escape(text)}</{name}>\n"
    return f"{pad}<{name}{attrs}/>\n"


def write_library_files(stig: dict, schema_dir: Path) -> Path:
    """Write <id>.json and <id>.xml into the shipped schema directory."""
    benchmark_id = stig["Benchmark"]["+@id"]
    schema_dir = Path(schema_dir)
    schema_dir.mkdir(parents=True, exist_ok=True)
    json_path = schema_dir / f"{benchmark_id}.json"
    xml_path = schema_dir / f"{benchmark_id}.xml"
    json_path.write_text(benchmark_to_json(stig), encoding="utf-8")
    xml_path.write_text(benchmark_to_xml(stig), encoding="utf-8")
    return json_path


def regenerate_manifest(schema_dir: Path, data_dir: Path) -> Path:
    """Rebuild manifest.json over every schema/*.json, mirroring the jq
    semantics in scripts/create-json-stigs.sh (glob/lexicographic order)."""
    schema_dir = Path(schema_dir)
    data_dir = Path(data_dir)
    entries = []
    for json_path in sorted(schema_dir.glob("*.json")):
        benchmark = json.loads(json_path.read_text(encoding="utf-8"))["Benchmark"]
        title = str(benchmark.get("title", ""))
        if title.endswith(STIG_SUFFIX):
            title = title[: -len(STIG_SUFFIX)]
        entries.append(
            {
                "id": benchmark["+@id"],
                "title": title,
                "description": benchmark.get("description", ""),
                "version": str(benchmark.get("version", "")),
                "date": (benchmark.get("status") or {}).get("+@date", ""),
                "source": "CIS" if benchmark["+@id"].startswith("CIS_") else "DISA",
                "category": (
                    classify(title)
                    if benchmark["+@id"].startswith("CIS_")
                    else "DISA STIG"
                ),
            }
        )
    manifest_path = data_dir / "stigs" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest_path

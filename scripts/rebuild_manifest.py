#!/usr/bin/env python3
"""Rebuild public/data/stigs/manifest.json over every schema/*.json.

Single source of truth for catalog metadata, called by both ingest
pipelines (scripts/create-json-stigs.sh after the DISA refresh, and
scripts/cis/run.py after a CIS conversion). Each manifest entry gains
the discovery fields the UI filters on, beyond source + title:

- category   technology class (Operating Systems, Server Software, ...)
             derived from the title keyword classifier below — for CIS
             and DISA alike, replacing the flat "DISA STIG" bucket
- type       document kind: DISA "STIG" vs "SRG" (Security Requirements
             Guide); CIS documents are "Benchmark"
- tags       free-form technology/vendor labels (Windows, VMware, z/OS,
             ...) — multiple can match one title
- rules_count  number of Rules in the benchmark, for dashboards

Titles that defeat the classifier can be corrected without code changes
via scripts/manifest_overrides.json (id -> {category?, tags?, type?});
it is read when present and otherwise ignored.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

STIG_SUFFIX = " Security Technical Implementation Guide"
SRG_SUFFIX = " Security Requirements Guide"

# Title keyword classifier, ordered by precedence (first hit wins).
# Keywords were built against both pipelines' title styles: CIS titles
# like "CIS Microsoft Azure ... Benchmark" and DISA titles like
# "VMware vSphere 8.0 ESXi Security Technical Implementation Guide".
CATEGORIES: list[tuple[list[str], str]] = [
    (
        ["Microsoft Azure", "Alibaba Cloud", "Tencent Cloud", "Amazon Web Services",
         "AWS ", "DigitalOcean", "Google Cloud", "Google Workspace", "IBM Cloud",
         "Oracle Cloud", "Snowflake", "Microsoft 365", "Okta", "Entra",
         "Dynamics 365", "Oracle SaaS", "Cloud Computing"],
        "Cloud Providers",
    ),
    (
        ["Intune", "iOS", "iPadOS", "Android", "Samsung Knox", "Mobile Policy",
         "visionOS", "BlackBerry", "MobileIron", "MaaS360", "ISEC7", "Omnissa",
         "UEM"],
        "Mobile Devices",
    ),
    (
        ["Cisco", "Arista", "Check Point", "Extreme Networks", "F5", "Forti",
         "HPE Aruba", "Juniper", "Palo Alto", "pfSense", "Sophos", "Dragos",
         "Forescout", "Infoblox", "OPNsense", "TippingPoint", "ProxySG",
         "Edge SWG", "NDM", "SDN", "Router", "Virtual Private Network",
         "Trellix", "Riverbed", "Switch", "ALG", "Application Layer Gateway",
         "WLAN", "Akamai", "Dell OS10", "FlexFabric", "DataPower", "DNS",
         "Firewall", "Intrusion Detection", "IDPS", "Network Infrastructure",
         "SEL-", "Network Device Management"],
        "Network Devices",
    ),
    (
        ["Everpure", "3PAR", "StoreServ", "StoreOnce", "Tape Management",
         "VTAPE", "Storage Device", "Alletra", "NetApp", "ONTAP", "ArcusOS"],
        "Storage Device",
    ),
    (
        ["Google Chrome", "Microsoft Edge", "Mozilla Firefox", "Safari",
         "Firefox", "Adobe", "Microsoft Office", "Visual Studio", "Java",
         "JRE", "Citrix Workspace App", "Microsoft Access", "Microsoft Excel",
         "Microsoft OneNote", "Microsoft Outlook", "Microsoft PowerPoint",
         "Microsoft Project", "Microsoft Publisher", "Microsoft Word",
         "Microsoft Visio", "OneDrive", "Skype", "Internet Explorer"],
        "Desktop Software",
    ),
    (
        ["GitHub", "GitLab", "Ansible", "Jenkins", "Docker Enterprise",
         "Git", "Artifactory", "SonarQube", "Rancher", "RKE2",
         "Application Security and Development"],
        "DevSecOps Tools",
    ),
    (
        ["Microsoft Windows", "Windows", "Ubuntu", "Red Hat", "RHEL", "Debian",
         "CentOS", "macOS", "AlmaLinux", "Rocky", "Amazon Linux", "Oracle Linux",
         "SUSE", "Linux Mint", "FreeBSD", "Solaris", "IBM AIX", "IBM i",
         "ChromeOS", "Azure Linux", "Bottlerocket", "Talos", "LXD",
         "Wind River", "Distribution Independent", "Robot Operating System",
         "Container-Optimized OS", "Container- Optimized OS", "RHEL8 on IBM Z",
         "z/OS", "zOS", "TOSS", "Photon OS", "Operating System", "NixOS"],
        "Operating Systems",
    ),
    (
        ["Docker", "Kubernetes", "VMware", "Apache", "Tomcat", "NGINX", "IIS",
         "SQL Server", "MySQL", "PostgreSQL", "MongoDB", "Exchange",
         "SharePoint", "WebSphere", "Db2", "BIND", "Cassandra", "CockroachDB",
         "Kerberos", "SingleStore", "OceanBase", "Yugabyte", "MariaDB",
         "CICS", "Oracle Database", "OpenShift", "Tanium", "Xylok",
         "zSecure", "DotNet", "Defender", "Citrix", "Splunk", "Redis",
         "Elasticsearch", "Ivanti", "Web Server", "Virtual Machine",
         "Virtualization", "Load Balancer", "MQ", "TDMF", "TADz", "SDSF",
         "NetView", "HCD", "Abend-AID", "ROSCOE", "NC-Pass", "SRRAUDIT",
         "CSSMTP", "CL/SuperSession", "MIM", "MICS", "Common Services",
         "Auditor", "MAINVIEW", "IOA", "CONTROL-O", "CONTROL-M", "CONTROL-D",
         "Catalog Solutions", "Health Checker", "Front End Processor",
         "Innoslate", "TCMax", "Unified Endpoint Management", "Knox",
         "EMM", "SDDC Manager", "vRealize", "Telco Cloud", "Proton",
         "Active Directory", "SCOM", "JBoss", "MarkLogic", "Crunchy",
         "EnterpriseDB", "EPAS", "Postgres", "Nutanix", "AvePoint",
         "Axonius", "Arctic Wolf", "Cylance", "HYCU", "HMC", "zVM",
         "Mainframe", "Voice, Video", "Container Platform",
         "Application Server", "Application Programming Interface",
         "AAA Services", "Database", "Enterprise Mobility", "IDMS"],
        "Server Software",
    ),
]

# Vendor/technology tags. Every tag whose keywords match the title is
# applied, so a benchmark can carry several (e.g. "VMware vSphere 8.0
# vCenter Appliance PostgreSQL" -> VMware + PostgreSQL).
TAGS: list[tuple[str, list[str]]] = [
    ("Microsoft", ["microsoft", "windows", "iis", "sql server", "exchange",
                   "sharepoint", "defender", "intune", ".net", "dotnet",
                   "visual studio", "office", "edge", "entra", "dynamics"]),
    ("Linux", ["linux", "ubuntu", "red hat", "rhel", "debian", "centos",
               "almalinux", "rocky", "amazon linux", "suse", "linux mint",
               "toss", "photon os", "bottlerocket"]),
    ("Apple", ["macos", "apple", "iOS", "ipados", "safari"]),
    ("Android", ["android"]),
    ("Google", ["google", "chromeos"]),
    ("IBM", ["ibm", "z/os", "zos ", "z/os ", "websphere", "db2", "cics",
             "aix", "lotus", "tivoli", "racf", "acf2", "tss"]),
    ("VMware", ["vmware", "vsphere", "esxi", "nsx", "vcenter", "vrealize",
                "sddc", "telco cloud"]),
    ("Citrix", ["citrix", "xendesktop", "xenapp", "xenserver", "hypervisor"]),
    ("Red Hat", ["red hat", "rhel", "openshift"]),
    ("Oracle", ["oracle", "java", "jre", "mysql", "virtualbox"]),
    ("Apache", ["apache", "tomcat", "http server"]),
    ("Cisco", ["cisco", "ios xr", "ios xe", "nexus", "firepower", "asa"]),
    ("AWS", ["aws", "amazon web services", "amazon linux"]),
    ("Kubernetes", ["kubernetes", "openshift", "talos", "rke"]),
    ("Docker", ["docker"]),
    ("Windows", ["windows"]),
    ("macOS", ["macos"]),
    ("z/OS", ["z/os", "zos ", "z/os ", "zos-"]),
    ("Windows Server", ["windows server"]),
    ("Browser", ["chrome", "firefox", "edge", "safari"]),
    ("Database", ["sql server", "mysql", "postgresql", "postgres", "mongodb",
                  "oracle database",
                  "db2", "mariadb", "redis", "cassandra", "cockroachdb",
                  "singlestore", "oceanbase", "yugabyte", "elasticsearch",
                  "crunchy", "enterprisedb", "marklogic", "idms"]),
    ("Network Device", ["cisco", "juniper", "palo alto", "f5", "forti",
                        "aruba", "arista", "ndm", "router", "switch",
                        "vpn", "sdn", "infoblox", "tippingpoint",
                        "proxysg", "edge swg", "sel-2740s"]),
    ("Cloud", ["azure", "aws", "amazon web services", "google cloud",
               "oracle cloud", "alibaba", "tencent", "digitalocean",
               "snowflake", "workspace", "microsoft 365", "okta", "saas"]),
    ("Virtualization", ["vmware", "vsphere", "esxi", "hypervisor", "citrix",
                        "kvm", "proxmox", "virtual machine", "virtualization",
                        "virtual machine manager"]),
    ("Mainframe", ["z/os", "zos ", "z/os ", "cics", "websphere", "db2",
                   "racf", "acf2", "tss", "mainview", "control-m", "control-d",
                   "control-o", "mics", "netview", "sdsf", "vtape"]),
    ("Endpoint Management", ["intune", "sophos", "samsung knox", "emm", "mdm",
                             "byoad", "cope", "cobo", "unified endpoint",
                             "workspace one", "ivanti", "mobile policy",
                             "blackberry", "mobileiron", "maas360", "omnissa",
                             "isec7", "uem"]),
]


def contains_keyword(title: str, lowered: str, keyword: str) -> bool:
    """Match keywords case-insensitively, except camel-case ones like
    "iOS" — whose lowercase form collides with Cisco's IOS."""
    if keyword == "iOS":
        return keyword in title
    return keyword.lower() in lowered


def classify(title: str) -> str:
    lowered = title.lower()
    for keywords, category in CATEGORIES:
        for keyword in keywords:
            if contains_keyword(title, lowered, keyword):
                return category
    return "Other"


def derive_tags(title: str) -> list[str]:
    lowered = title.lower()
    tags = []
    for tag, keywords in TAGS:
        if any(contains_keyword(title, lowered, keyword) for keyword in keywords):
            tags.append(tag)
    return tags


def derive_type(source: str, title: str) -> str:
    if source == "CIS":
        return "Benchmark"
    return "SRG" if SRG_SUFFIX in title else "STIG"


def group_count(benchmark: dict) -> int:
    groups = benchmark.get("Group")
    if groups is None:
        return 0
    if isinstance(groups, dict):
        groups = [groups]
    return len(groups)


def load_overrides(data_dir: Path) -> dict:
    path = Path(__file__).resolve().parent / "manifest_overrides.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return raw if isinstance(raw, dict) else {}


def build_entry(benchmark: dict, overrides: dict) -> dict:
    title = str(benchmark.get("title", ""))
    if title.endswith(STIG_SUFFIX):
        title = title[: -len(STIG_SUFFIX)]
    source = "CIS" if benchmark["+@id"].startswith("CIS_") else "DISA"
    entry = {
        "id": benchmark["+@id"],
        "title": title,
        "description": benchmark.get("description", ""),
        "version": str(benchmark.get("version", "")),
        "date": (benchmark.get("status") or {}).get("+@date", ""),
        "source": source,
        "category": classify(title),
        "type": derive_type(source, title),
        "tags": derive_tags(title),
        "rules_count": group_count(benchmark),
    }
    override = overrides.get(entry["id"], {})
    for field in ("category", "type", "tags"):
        if field in override:
            entry[field] = override[field]
    return entry


def rebuild(schema_dir: Path, data_dir: Path) -> Path:
    """Rebuild manifest.json over every schema/*.json, mirroring the
    glob/lexicographic order the two pipelines have always used."""
    schema_dir = Path(schema_dir)
    data_dir = Path(data_dir)
    overrides = load_overrides(data_dir)
    entries = []
    for json_path in sorted(schema_dir.glob("*.json")):
        benchmark = json.loads(json_path.read_text(encoding="utf-8"))["Benchmark"]
        entries.append(build_entry(benchmark, overrides))
    manifest_path = data_dir / "stigs" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema-dir", type=Path, required=True,
                        help="directory holding <id>.json benchmark files")
    parser.add_argument("--data-dir", type=Path, required=True,
                        help="directory containing stigs/ (manifest lands in "
                             "stigs/manifest.json)")
    args = parser.parse_args()
    print(f"manifest: {rebuild(args.schema_dir, args.data_dir)}")

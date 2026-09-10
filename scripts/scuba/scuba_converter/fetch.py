"""Fetch ScubaGear baseline documents at a release tag.

Baselines are immutable per tag, so downloads are cached under
data/scuba/<tag>/ (gitignored — only converted output is committed).
The documents themselves are CC0.
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

GITHUB_REPO = "cisagov/ScubaGear"
BASELINES_PATH = "PowerShell/ScubaGear/baselines"

# Baseline files converted into the library. removedpolicies.md is
# fetched too, for the validator's removal cross-check.
PRODUCT_FILES = [
    "aad",
    "defender",
    "exo",
    "powerbi",
    "powerplatform",
    "sharepoint",
    "teams",
]
REMOVED_POLICIES_FILE = "removedpolicies"


def normalize_tag(tag: str) -> str:
    """Accept `1.8.0` or `v1.8.0`; return the `v`-prefixed tag used in
    URLs, plus expose the bare form for version strings."""
    tag = tag.strip()
    if not tag:
        raise ValueError("empty tag")
    return tag if tag.startswith("v") else f"v{tag}"


def bare_version(tag: str) -> str:
    return normalize_tag(tag).lstrip("v")


def _request(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "stigui-scuba-converter"})
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token and "api.github.com" in url:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _api(path: str) -> dict:
    return json.loads(_request(f"https://api.github.com/repos/{GITHUB_REPO}{path}"))


def latest_release() -> dict:
    """{"tag": "v1.8.0", "version": "1.8.0", "date": "2026-05-07"}"""
    release = _api("/releases/latest")
    tag = release["tag_name"]
    return {
        "tag": tag,
        "version": bare_version(tag),
        "date": release["published_at"][:10],
    }


def release_meta(tag: str) -> dict:
    release = _api(f"/releases/tags/{normalize_tag(tag)}")
    return {
        "tag": release["tag_name"],
        "version": bare_version(release["tag_name"]),
        "date": release["published_at"][:10],
    }


def tag_cache_dir(repo_root: Path, tag: str) -> Path:
    return Path(repo_root) / "data" / "scuba" / normalize_tag(tag)


def fetch_tag(repo_root: Path, tag: str, force: bool = False) -> Path:
    """Download every baseline document at `tag` into the cache dir;
    returns the cache dir. Cached files are reused unless `force`."""
    versioned = normalize_tag(tag)
    cache_dir = tag_cache_dir(repo_root, versioned)
    files = PRODUCT_FILES + [REMOVED_POLICIES_FILE]
    missing = [f"{name}.md" for name in files]
    if not force:
        missing = [name for name in missing if not (cache_dir / name).exists()]
    if missing:
        cache_dir.mkdir(parents=True, exist_ok=True)
        for name in missing:
            stem = name[: -len(".md")]
            url = (
                f"https://raw.githubusercontent.com/{GITHUB_REPO}"
                f"/{versioned}/{BASELINES_PATH}/{stem}.md"
            )
            (cache_dir / name).write_bytes(_request(url))
    return cache_dir

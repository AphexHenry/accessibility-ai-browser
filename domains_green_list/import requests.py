"""
build_type_a_allowlist.py

Builds a Type A (fully trusted, never scan) domain allowlist by:
  1. Pulling the Tranco top 50k list (popularity base)
  2. Pulling the Mozilla Public Suffix List (removes subdomain-based platforms)
  3. Removing high-risk TLDs
  4. Merging your manual seeds
  5. Saving the result to type_a_allowlist.json and type_a_allowlist.csv

Also produces path_based_platforms.json — domains that are in Type A but
must still be scanned because they host user-generated content at the path
level (e.g. storage.googleapis.com/anything).

Lookup logic in your browser extension / backend:
    domain = extract_domain(url)
    if domain not in TYPE_A:          → scan  (unknown)
    if domain in PATH_PLATFORMS:      → scan  (user-generated content)
    else:                             → skip  (fully trusted)

Run weekly via cron or any scheduler.
"""

import requests
import json
import csv
import io
import zipfile
from datetime import datetime
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

OUTPUT_DIR   = Path(".")
TRANCO_TOP_N = 50_000

# High-risk TLDs — statistically associated with scam/spam.
# Removed even if they appear in Tranco top 50k.
BAD_TLDS = {
    ".tk", ".ml", ".ga", ".cf", ".gq",   # free Freenom TLDs, massively abused
    ".xyz", ".top", ".click", ".gdn",
    ".loan", ".work", ".date", ".faith",
}

# Domains to force-include regardless of automated filtering.
# Add your market's banks, gov portals, health services, etc.
MANUAL_SEEDS = [
    # Examples — replace/extend with your actual market:
    # "ing.de",
    # "bundesregierung.de",
    # "techniker-krankenkasse.de",
]

# ── Path-based platforms ──────────────────────────────────────────────────────
# These companies ARE trusted (so they appear in Type A), but their URLs can
# point to user-generated content — so any URL on them must still be scanned.
# This list is saved separately as path_based_platforms.json.

PATH_BASED_PLATFORMS = sorted([
    # Google
    "storage.googleapis.com",
    "firebasestorage.googleapis.com",
    "sites.google.com",
    "docs.google.com",
    "drive.google.com",
    # Amazon
    "s3.amazonaws.com",
    # Microsoft / Azure
    "blob.core.windows.net",
    "onedrive.live.com",
    "sharepoint.com",
    # Dropbox
    "dropbox.com",
    "dl.dropboxusercontent.com",
    # Meta
    "l.facebook.com",       # Facebook link shim — redirects to anything
    # Messaging
    "t.me",                 # Telegram public links
    "discord.gg",
    # Form builders
    "forms.gle",
    "typeform.com",
    "jotform.com",
    # Website builders (path-based, not subdomain-based)
    "wix.com",
    "weebly.com",
    # Document / productivity
    "notion.so",
    "coda.io",
    "airtable.com",
    # File sharing
    "wetransfer.com",
    "sendspace.com",
])

# ── Sources ───────────────────────────────────────────────────────────────────

PSL_URL    = "https://publicsuffix.org/list/public_suffix_list.dat"
TRANCO_URL = "https://tranco-list.eu/top-1m.csv.zip"

# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch_text(url: str) -> str:
    print(f"  Fetching {url} ...")
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.text


def fetch_bytes(url: str) -> bytes:
    print(f"  Fetching {url} ...")
    r = requests.get(url, timeout=60, stream=True)
    r.raise_for_status()
    return r.content


# ── Step 1: Tranco top N ──────────────────────────────────────────────────────

def load_tranco_domains(top_n: int) -> set[str]:
    print(f"\n[1/3] Loading Tranco top {top_n:,}...")
    raw_bytes = fetch_bytes(TRANCO_URL)

    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
        csv_name = z.namelist()[0]
        with z.open(csv_name) as f:
            reader  = csv.reader(io.TextIOWrapper(f))
            domains = set()
            for rank, row in enumerate(reader, start=1):
                if rank > top_n:
                    break
                if row:
                    domains.add(row[1].strip().lower())

    print(f"  → {len(domains):,} domains loaded")
    return domains


# ── Step 2: Public Suffix List ────────────────────────────────────────────────

def load_psl_platforms() -> set[str]:
    """
    Domains where subdomains are independently owned (subdomain-based hosting).
    e.g. github.io, netlify.app, blogspot.com
    These are removed from Type A entirely — a subdomain = user content.
    """
    print("\n[2/3] Loading Mozilla Public Suffix List...")
    raw = fetch_text(PSL_URL)

    platforms = set()
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        platforms.add(line.lstrip("*."))

    print(f"  → {len(platforms):,} platform/suffix entries")
    return platforms


# ── Step 3: Build final list ──────────────────────────────────────────────────

def build_allowlist(tranco: set[str], platforms: set[str], seeds: list[str]) -> list[str]:
    print("\n[3/3] Building allowlist...")

    allowlist = set(tranco)
    print(f"  Start:           {len(allowlist):,}  (Tranco top {TRANCO_TOP_N:,})")

    allowlist -= platforms
    print(f"  − PSL platforms: {len(allowlist):,}")

    allowlist = {d for d in allowlist if not any(d.endswith(t) for t in BAD_TLDS)}
    print(f"  − bad TLDs:      {len(allowlist):,}")

    for seed in seeds:
        allowlist.add(seed.strip().lower())
    if seeds:
        print(f"  + {len(seeds)} manual seeds")

    print(f"  = Final:         {len(allowlist):,} trusted domains")
    return sorted(allowlist)


# ── Output ────────────────────────────────────────────────────────────────────

def save(domains: list[str]) -> None:
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    # Type A allowlist — JSON
    json_path = OUTPUT_DIR / "type_a_allowlist.json"
    with open(json_path, "w") as f:
        json.dump({"generated_at": ts, "count": len(domains), "domains": domains}, f, indent=2)
    print(f"\n  ✓ {json_path.resolve()}  ({len(domains):,} domains)")

    # Type A allowlist — CSV (easy to diff in git week-to-week)
    csv_path = OUTPUT_DIR / "type_a_allowlist.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["domain"])
        writer.writerows([[d] for d in domains])
    print(f"  ✓ {csv_path.resolve()}")

    # Path-based platforms — used at lookup time alongside the allowlist
    pbp_path = OUTPUT_DIR / "path_based_platforms.json"
    with open(pbp_path, "w") as f:
        json.dump(
            {
                "note": "Domains in Type A that still require content scanning "
                        "because they host user-generated content at the path level.",
                "count": len(PATH_BASED_PLATFORMS),
                "domains": PATH_BASED_PLATFORMS,
            },
            f, indent=2,
        )
    print(f"  ✓ {pbp_path.resolve()}  ({len(PATH_BASED_PLATFORMS)} entries)")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("Building Type A allowlist")
    print("=" * 60)

    tranco    = load_tranco_domains(TRANCO_TOP_N)
    platforms = load_psl_platforms()
    domains   = build_allowlist(tranco, platforms, MANUAL_SEEDS)

    print("\nSaving output files...")
    save(domains)

    print("\nDone.")


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""Generate Tauri updater latest.json from signed release assets.

Usage: generate-latest-json.py <version> <signed_dir>

Reads .sig files alongside the binaries and emits the JSON the Tauri
updater polls. The signature is verified client-side by the app using
the embedded public key — the transport (GitHub, Cloudflare) is untrusted.
"""
from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path


def main() -> None:
    version = sys.argv[1]
    signed_dir = Path(sys.argv[2])

    tag = f"v{version}"
    base = f"https://github.com/TruJ0e/TruCalenZer-Releases/releases/download/{tag}"

    platforms: dict[str, dict[str, str]] = {}

    # Windows x86_64 NSIS installer
    win_exe = signed_dir / f"TruCalenZer_{version}_x64-setup.exe"
    win_sig = Path(str(win_exe) + ".sig")
    if win_exe.exists() and win_sig.exists():
        platforms["windows-x86_64"] = {
            "signature": win_sig.read_text("ascii").strip(),
            "url": f"{base}/{win_exe.name}",
        }

    # macOS aarch64 DMG (Tauri updater uses the .app.tar.gz, but we ship DMG
    # for manual download; include for completeness)
    mac_dmg = signed_dir / f"TruCalenZer_{version}_aarch64.dmg"
    mac_sig = Path(str(mac_dmg) + ".sig")
    if mac_dmg.exists() and mac_sig.exists():
        platforms["darwin-aarch64"] = {
            "signature": mac_sig.read_text("ascii").strip(),
            "url": f"{base}/{mac_dmg.name}",
        }

    if not platforms:
        raise SystemExit("No signed artifacts found; refusing to emit latest.json")

    doc = {
        "version": version,
        "notes": f"TruCalenZer {version}.",
        "pub_date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "platforms": platforms,
    }
    print(json.dumps(doc, indent=4))


if __name__ == "__main__":
    main()

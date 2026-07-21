#!/usr/bin/env python3
"""Auto-connect opencode to agentglass via its plugin system.

agentglass exposes an HTTP /ingest endpoint that accepts normalised events
from any provider.  This script deploys the opencode plugin (a JS file that
hooks into opencode's event bus and POSTs events to /ingest) into the user's
opencode plugin directory, ensures the @opencode-ai/plugin dependency is
present, and runs bun install.

  python3 hooks/connect_opencode.py               # deploy the plugin
  python3 hooks/connect_opencode.py --undo        # remove it again
  python3 hooks/connect_opencode.py --postinstall # lifecycle mode (honours AGENTGLASS_NO_OPENCODE)

Idempotent, backs up before overwriting, and never fails the install.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

SERVER = os.environ.get("AGENTGLASS_SERVER", "http://localhost:4000").rstrip("/")

PLUGIN_FILENAME = "agentglass.js"
PLUGIN_SRC = Path(__file__).resolve().parent / "opencode-plugin.js"


def _agentglass_local_only(url):
    import os
    from urllib.parse import urlparse
    if os.environ.get("AGENTGLASS_ALLOW_REMOTE"):
        return
    u = urlparse(url or "")
    if u.scheme not in ("http", "https") or (u.hostname or "") not in ("localhost", "127.0.0.1", "::1"):
        sys.stderr.write("[agentglass] refusing non-local server %r\n" % url)
        sys.exit(0)


def _opencode_config_dir():
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else Path.home() / ".config"
    return base / "opencode"


def _backup(path: Path) -> None:
    if path.exists():
        bak = path.with_name(path.name + f".bak.agentglass.{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(path, bak)
        print(f"[agentglass] backup -> {bak}")


def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text()) if path.exists() else {}
    except Exception:
        return {}


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def _has_bun():
    return shutil.which("bun") is not None


def opencode_installed() -> bool:
    cfg = _opencode_config_dir()
    return cfg.exists() or shutil.which("opencode") is not None


def wire_plugin(undo: bool) -> bool:
    cfg = _opencode_config_dir()
    dest = cfg / "plugins" / PLUGIN_FILENAME

    if undo:
        if dest.exists():
            _backup(dest)
            dest.unlink()
            print(f"[agentglass] removed opencode plugin ({dest})")
        else:
            print("[agentglass] opencode plugin not found — nothing to undo.")
        return True

    if not PLUGIN_SRC.exists():
        print(f"[agentglass] plugin source not found: {PLUGIN_SRC}")
        return False

    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / "plugins").mkdir(parents=True, exist_ok=True)

    if dest.exists():
        existing = dest.read_text()
        new = PLUGIN_SRC.read_text()
        if existing == new:
            print("[agentglass] opencode plugin already installed — nothing to do.")
            return True
        _backup(dest)

    shutil.copy2(PLUGIN_SRC, dest)
    print(f"[agentglass] deployed opencode plugin -> {dest}")

    pkg_path = cfg / "package.json"
    pkg = _load(pkg_path)
    deps = pkg.get("dependencies", {})
    if "@opencode-ai/plugin" not in deps:
        deps["@opencode-ai/plugin"] = "1.17.18"
        pkg["dependencies"] = deps
        _write(pkg_path, pkg)
        print(f"[agentglass] added @opencode-ai/plugin to {pkg_path}")

    if _has_bun():
        try:
            subprocess.run(
                ["bun", "install"],
                cwd=str(cfg),
                capture_output=True,
                timeout=60,
            )
            print(f"[agentglass] ran bun install in {cfg}")
        except Exception as e:
            print(f"[agentglass] bun install failed ({e}) — you may need to run it manually.")
    else:
        print("[agentglass] bun not found — you may need to run `bun install` manually in "
              f"{cfg} for the plugin dependency to resolve.")

    print("[agentglass]   start a new `opencode` session for the plugin to activate.")
    return True


def check_server() -> None:
    import urllib.request
    try:
        req = urllib.request.Request(f"{SERVER}/health", method="GET")
        with urllib.request.urlopen(req, timeout=2) as resp:
            if resp.status == 200:
                print(f"[agentglass] server is reachable at {SERVER}")
            else:
                print(f"[agentglass] server responded {resp.status} at {SERVER}")
    except Exception:
        print(f"[agentglass] server not reachable at {SERVER} — is agentglass running?")


def main() -> None:
    ap = argparse.ArgumentParser(description="Connect opencode to agentglass via plugin.")
    ap.add_argument("--undo", action="store_true", help="remove the agentglass opencode plugin")
    ap.add_argument("--postinstall", action="store_true", help="lifecycle mode: honour AGENTGLASS_NO_OPENCODE, never fail")
    args = ap.parse_args()
    _agentglass_local_only(SERVER)

    if args.postinstall and os.environ.get("AGENTGLASS_NO_OPENCODE"):
        print("[agentglass] AGENTGLASS_NO_OPENCODE set — skipping opencode auto-connect.")
        return

    if not opencode_installed():
        if not args.postinstall:
            print("[agentglass] opencode not detected (looked for ~/.config/opencode/ or `opencode` in PATH).")
        return

    try:
        wire_plugin(args.undo)
    except Exception as e:
        print(f"[agentglass] opencode auto-connect skipped ({e}).")
        return

    if not args.undo:
        check_server()


if __name__ == "__main__":
    main()

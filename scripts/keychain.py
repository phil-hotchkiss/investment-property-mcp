#!/usr/bin/env python3
"""Keychain-backed secret store (macOS `security` CLI, stdlib only).

API keys live in the macOS Keychain under the service `rental-deal-math`.
Processes fetch them at start, so nothing sits in `.zshrc` or `.env`.
Off macOS (CI), `get` falls back to the env var of the same name.

  python3 scripts/keychain.py set ANTHROPIC_API_KEY     # stdin or prompt, never argv
  python3 scripts/keychain.py get ANTHROPIC_API_KEY
  python3 scripts/keychain.py delete ANTHROPIC_API_KEY
  eval "$(python3 scripts/keychain.py env ANTHROPIC_API_KEY)"
"""

import getpass
import os
import shlex
import subprocess
import sys

SERVICE = "rental-deal-math"


def _mac() -> bool:
    return sys.platform == "darwin"


def get(name: str) -> str | None:
    if not _mac():
        return os.environ.get(name)
    r = subprocess.run(
        ["security", "find-generic-password", "-s", SERVICE, "-a", name, "-w"],
        capture_output=True,
        text=True,
    )
    return r.stdout.rstrip("\n") if r.returncode == 0 else None


def set(name: str, value: str) -> None:
    # ponytail: the security CLI only takes -w on argv, so the value is briefly visible to `ps`.
    subprocess.run(
        ["security", "add-generic-password", "-U", "-s", SERVICE, "-a", name, "-w", value],
        check=True,
        capture_output=True,
    )


def delete(name: str) -> None:
    subprocess.run(
        ["security", "delete-generic-password", "-s", SERVICE, "-a", name],
        check=True,
        capture_output=True,
    )


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] not in ("get", "set", "delete", "env"):
        print("usage: keychain.py get|set|delete NAME | env NAME...", file=sys.stderr)
        return 2
    cmd, names = argv[0], argv[1:]
    if cmd in ("set", "delete") and not _mac():
        print(f"{cmd} needs the macOS Keychain; on other platforms use an env var.", file=sys.stderr)
        return 2
    if cmd == "get":
        value = get(names[0])
        if value is None:
            return 1
        print(value)
    elif cmd == "env":
        for n in names:
            value = get(n)
            if value is None:
                print(f"missing secret: {n}", file=sys.stderr)
                return 1
            print(f"export {n}={shlex.quote(value)}")
    elif cmd == "set":
        value = sys.stdin.readline().rstrip("\n") if not sys.stdin.isatty() else getpass.getpass(f"{names[0]}: ")
        if not value:
            print("empty value", file=sys.stderr)
            return 1
        set(names[0], value)
    else:
        delete(names[0])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

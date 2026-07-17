#!/usr/bin/env python3
"""NyaaLibrary-MCP macmini 端部署: pull → down → up -d → prune → ps.

Usage (macmini):
  python3 restart.py
"""

import subprocess
import sys
from pathlib import Path


PROJECT = "nyaalibrary-mcp"
COMPOSE_FILE = "docker-compose.yml"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(cmd)}")
    return subprocess.run(cmd, **kwargs)


def main() -> None:
    cwd = Path(__file__).resolve().parent

    # 1) Pull
    print(f"\n[1/5] Pulling latest {PROJECT} image ...")
    r = run(["docker", "compose", "-f", COMPOSE_FILE, "pull"], cwd=cwd)
    if r.returncode != 0:
        print("[ERROR] Pull failed.")
        sys.exit(1)

    # 2) Down
    print(f"\n[2/5] Stopping {PROJECT} ...")
    run(["docker", "compose", "-f", COMPOSE_FILE, "down"], cwd=cwd)

    # 3) Up
    print(f"\n[3/5] Starting {PROJECT} ...")
    r = run(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d"], cwd=cwd)
    if r.returncode != 0:
        print("[ERROR] Up failed.")
        sys.exit(1)

    # 4) Prune
    print(f"\n[4/5] Pruning dangling images ...")
    run(["docker", "image", "prune", "-f"], cwd=cwd)

    # 5) Status
    print(f"\n[5/5] Container status:")
    run(["docker", "ps", "--filter", f"name={PROJECT}", "--format",
         "table {{.Names}}\t{{.Status}}\t{{.Ports}}"], cwd=cwd)

    print(f"\n{PROJECT} deploy complete.")


if __name__ == "__main__":
    main()

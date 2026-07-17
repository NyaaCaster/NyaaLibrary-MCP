#!/usr/bin/env python3
"""NyaaLibrary-MCP: build image → push to private registry (NyaaDockerHUB).

Usage:
  python rebuild.py              # build + push + registry cleanup + local cleanup
  python rebuild.py --no-cache   # force full rebuild without Docker layer cache
  python rebuild.py --skip-push  # local build only (offline / debugging)

Registry credentials read from .env (PRIVATE_DOCKER_REGISTRY_HOST).
Neither value is ever hardcoded in this file.
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib import request, error as urllib_error

PROJECT = "nyaalibrary-mcp"
IMAGE = "nyaalibrary-mcp"
RETRY_MAX = 3
RETRY_DELAY = 2  # seconds


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def load_env() -> dict[str, str]:
    """Load .env into a dict (simple parser, no dotenv dependency)."""
    env = {}
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        print("[ERROR] .env not found. Cannot proceed without registry config.")
        sys.exit(1)
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            env[k] = v
    return env


def mask(text: str, secrets: list[str]) -> str:
    """Replace every occurrence of each secret with <PRIVATE_REGISTRY>."""
    for s in secrets:
        if s:
            text = text.replace(s, "<PRIVATE_REGISTRY>")
    return text


def run(cmd: list[str], secrets: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run a command, printing masked output."""
    masked_cmd = mask(" ".join(cmd), secrets)
    print(f"  $ {masked_cmd}")
    return subprocess.run(cmd, **kwargs)


def git_sha(length: int = 7) -> str:
    """Return short git HEAD SHA."""
    r = subprocess.run(
        ["git", "rev-parse", f"--short={length}", "HEAD"],
        capture_output=True, text=True, cwd=Path(__file__).resolve().parent,
    )
    if r.returncode != 0:
        print("[ERROR] git rev-parse failed. Are we in a git repo?")
        sys.exit(1)
    return r.stdout.strip()


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=f"Build & push {PROJECT} image")
    parser.add_argument("--no-cache", action="store_true", help="Force full rebuild")
    parser.add_argument("--skip-push", action="store_true", help="Build only, skip push")
    args = parser.parse_args()

    env = load_env()
    host = env.get("PRIVATE_DOCKER_REGISTRY_HOST", "")
    if not host and not args.skip_push:
        print("[ERROR] PRIVATE_DOCKER_REGISTRY_HOST not set in .env, and --skip-push not specified.")
        sys.exit(1)

    secrets = [host] if host else []
    sha = git_sha()

    image_latest = f"{host}/{IMAGE}:latest"
    image_sha = f"{host}/{IMAGE}:{sha}"
    image_latest_m = f"<PRIVATE_REGISTRY>/{IMAGE}:latest"
    image_sha_m = f"<PRIVATE_REGISTRY>/{IMAGE}:{sha}"

    cwd = Path(__file__).resolve().parent

    # 1) Build
    print(f"\n[1/4] Building {image_sha_m} ...")
    build_cmd = ["docker", "build", "-t", image_sha, "-t", image_latest, str(cwd)]
    if args.no_cache:
        build_cmd.insert(2, "--no-cache")
    r = subprocess.run(build_cmd)
    if r.returncode != 0:
        print("[ERROR] Docker build failed.")
        sys.exit(1)
    print(f"  -> {image_sha_m} built successfully.")

    if args.skip_push:
        print("[skip-push] Done. Image built locally only.")
        return

    # 2) Push (with retry)
    print(f"\n[2/4] Pushing {image_sha_m} (retry up to {RETRY_MAX}x) ...")
    for attempt in range(1, RETRY_MAX + 1):
        r = subprocess.run(["docker", "push", image_sha])
        if r.returncode == 0:
            break
        print(f"  Push attempt {attempt} failed, retrying in {RETRY_DELAY}s...")
        time.sleep(RETRY_DELAY)
    else:
        print("[ERROR] Docker push failed after all retries.")
        sys.exit(1)

    print(f"\n[3/4] Pushing {image_latest_m} ...")
    r = subprocess.run(["docker", "push", image_latest])
    if r.returncode != 0:
        print("[WARN] latest tag push failed (non-fatal).")

    # 3) Registry cleanup
    print("\n[4/4] Cleaning old manifests from registry ...")
    try:
        _cleanup_registry(host, IMAGE, sha)
    except Exception as e:
        print(f"[WARN] Registry cleanup skipped: {e}")

    # 4) Local cleanup
    _cleanup_local(IMAGE)

    print(f"\nDone. {image_sha_m} pushed & old tags cleaned.")


def _cleanup_registry(host: str, image: str, current_sha: str) -> None:
    """Delete stale SHA-tagged manifests from the registry.

    The Distribution (registry:2) API only supports DELETE by digest — a
    DELETE by tag reference returns HTTP 400. But deleting a digest removes
    *every* tag pointing at it, so we must protect the digests referenced by
    `latest` and the current SHA (which are identical when image content is
    unchanged) and skip any old tag that resolves to a protected digest.
    """
    base = f"http://{host}/v2/{image}/manifests"
    accept = {"Accept": "application/vnd.docker.distribution.manifest.v2+json"}

    def digest_of(ref: str) -> str:
        try:
            req = request.Request(f"{base}/{ref}", headers=accept)
            resp = request.urlopen(req, timeout=10)
            return resp.headers.get("Docker-Content-Digest", "")
        except urllib_error.HTTPError:
            return ""

    try:
        tags_url = f"http://{host}/v2/{image}/tags/list"
        resp = request.urlopen(tags_url, timeout=10)
        data = __import__("json").loads(resp.read())
        tags = data.get("tags") or []

        # Digests we must never delete (live image, possibly shared by tags).
        protected = {d for d in (digest_of("latest"), digest_of(current_sha)) if d}

        deleted: set[str] = set()
        for tag in tags:
            if tag in ("latest", current_sha):
                continue
            digest = digest_of(tag)
            if not digest or digest in protected or digest in deleted:
                continue
            try:
                del_req = request.Request(f"{base}/{digest}", method="DELETE")
                request.urlopen(del_req, timeout=10)
                deleted.add(digest)
                print(f"  Deleted: {image}:{tag} ({digest[:19]}...)")
            except urllib_error.HTTPError as e:
                if e.code != 404:
                    print(f"  [WARN] Failed to delete {tag}: HTTP {e.code}")
    except Exception as e:
        print(f"  [WARN] Registry cleanup error: {e}")


def _cleanup_local(image: str) -> None:
    subprocess.run(["docker", "image", "prune", "-f"], capture_output=True)
    print("  Local dangling images pruned.")


if __name__ == "__main__":
    main()

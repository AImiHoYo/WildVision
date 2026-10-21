"""Read-only public-tree audit using Git's actual ignore rules and a temporary index.

No files are staged and no repository is created in the project. Output contains
paths, sizes and rule names only, never matched credential values. This is a
basic preflight, not a replacement for human review or a dedicated secret scan.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    # Do not let a developer's global Git exclusions conceal candidate files.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)

    def git(*parts: str, check: bool = True) -> subprocess.CompletedProcess:
        return subprocess.run(["git", *parts], env=env, capture_output=True, check=check)

    with tempfile.TemporaryDirectory(prefix="wildvision-public-audit-") as temp:
        git("init", "--quiet", temp)
        result = git("--git-dir", str(Path(temp) / ".git"), "--work-tree", str(root),
                     "-c", f"core.excludesFile={os.devnull}", "ls-files", "--others",
                     "--exclude-standard", "-z")
        candidates = set(filter(None, os.fsdecode(result.stdout).split("\0")))

    tracked: set[str] = set()
    tracked_ignored: list[str] = []
    top = git("-C", str(root), "rev-parse", "--show-toplevel", check=False)
    has_repo = top.returncode == 0 and Path(os.fsdecode(top.stdout).strip()).resolve() == root
    if has_repo:
        tracked = set(filter(None, os.fsdecode(git("-C", str(root), "ls-files", "-z").stdout).split("\0")))
        tracked_ignored = list(filter(None, os.fsdecode(git("-C", str(root), "ls-files", "-ci", "--exclude-standard", "-z").stdout).split("\0")))
    candidates |= tracked

    rules = {
        "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"),
        "github_token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
        "aws_access_key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
        "api_token": re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b"),
    }
    local_path = re.compile(r"(?:/Users/[\w .-]+/|/home/[\w .-]+/|[A-Za-z]:\\Users\\[\w .-]+\\)")
    records, findings = [], []
    for rel in sorted(candidates):
        path = root / rel
        if path.is_symlink():
            findings.append({"path": rel, "rule": "symlink_requires_review"})
            continue  # Never follow a public candidate into private files.
        if not path.is_file():
            continue
        size = path.stat().st_size
        records.append({"path": rel, "bytes": size, "tracked": rel in tracked})
        if size > 2_000_000:
            findings.append({"path": rel, "rule": "large_file_not_content_scanned"})
            continue
        data = path.read_bytes()
        if b"\0" in data:
            continue
        try:
            contents = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            continue
        for line_no, line in enumerate(contents.splitlines(), 1):
            for name, pattern in rules.items():
                if pattern.search(line):
                    findings.append({"path": rel, "line": line_no, "rule": name})
            if local_path.search(line):
                findings.append({"path": rel, "line": line_no, "rule": "local_absolute_path_review"})

    report = {
        "has_project_git_repository": has_repo,
        "candidate_count": len(records),
        "candidate_bytes": sum(x["bytes"] for x in records),
        "tracked_but_ignored": sorted(tracked_ignored),
        "findings": findings,
        "files": records,
        "limitations": ["No remote publication, staging or Git history scan performed.",
                        "Binary contents, archives, large files and ownership require separate review.",
                        "No matches does not establish absence of secrets or permission to distribute."],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if findings or tracked_ignored else 0


if __name__ == "__main__":
    raise SystemExit(main())

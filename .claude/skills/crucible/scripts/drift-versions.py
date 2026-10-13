#!/usr/bin/env python3
import json
import re
import subprocess
import sys
from pathlib import Path

SEMVER = r"(\d+\.\d+\.\d+)"
EXACT = re.compile(r"^\d+\.\d+\.\d+$")
SECTIONS = ("dependencies", "devDependencies")
PACKAGE_FILES = ("engine/package.json", "apps/package.json")
DOC_DIRS = ("docs", "engine/docs")


def names_for(package):
    names = {package}
    if "/" in package:
        tail = package.split("/", 1)[1]
        names.add(tail)
        if tail.startswith("pi-"):
            names.add("pi")
    return names


def pins(root):
    found = {}
    for relative in PACKAGE_FILES:
        path = root / relative
        if not path.is_file():
            continue
        data = json.loads(path.read_text())
        for section in SECTIONS:
            for package, version in data.get(section, {}).items():
                if EXACT.match(version):
                    found.setdefault(package, set()).add(version)
    return found


def main():
    if len(sys.argv) != 1:
        print("Usage: drift-versions.py", file=sys.stderr)
        sys.exit(2)
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    if result.returncode != 0:
        print("drift-versions: run it inside the git repository", file=sys.stderr)
        sys.exit(2)
    root = Path(result.stdout.strip())

    rules = []
    for package, versions in pins(root).items():
        for name in names_for(package):
            pattern = re.compile(
                r"(?<![\w/@.-])" + re.escape(name) + r"(?![\w-])[\s@`'\"(:=v]{1,6}" + SEMVER
            )
            rules.append((package, name, pattern, versions))

    hits = {}
    for directory in DOC_DIRS:
        base = root / directory
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*.md")):
            for number, line in enumerate(path.read_text().splitlines(), start=1):
                for package, name, pattern, versions in rules:
                    for match in pattern.finditer(line):
                        if match.group(1) not in versions:
                            key = (f"{path.relative_to(root)}:{number}", name, match.group(1))
                            hits.setdefault(key, set()).update(
                                f"{package} {version}" for version in versions
                            )
    for (where, name, found), pinned in hits.items():
        print(f"{where}: {name} {found}, pinned {', '.join(sorted(pinned))}")
    sys.exit(1 if hits else 0)


if __name__ == "__main__":
    main()

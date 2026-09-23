#!/usr/bin/env python3
"""Check documentation links and the public artifact boundary without dependencies."""

import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

REPO = Path(__file__).resolve().parents[2]
PUBLIC = REPO / "docs"
SECTIONS = {"reference", "explanation", "tutorials", "how-to-guides"}
MAX_FILES = 2048
MAX_LINKS = 4096


def is_public(path):
    assert isinstance(path, Path), "Expected a relative path"
    assert not path.is_absolute(), "Public paths must be relative"
    if path.parts[0] in SECTIONS | {"assets"}:
        return True
    return path.as_posix() in {
        "README.md",
        "index.html",
        "viewer.html",
        "CNAME",
        ".nojekyll",
    }


def check_link(source, href, boundary, public):
    assert source.is_file(), "Link source must exist"
    assert source.is_relative_to(boundary), "Source must be inside its boundary"
    url = urlsplit(href)
    if url.scheme or url.netloc:
        return
    target = (source.parent / unquote(url.path)).resolve() if url.path else source
    if not target.is_relative_to(boundary):
        raise ValueError(f"{source}: link escapes documentation boundary: {href}")
    if not target.exists():
        raise ValueError(f"{source}: broken link: {href}")
    if public and not is_public(target.relative_to(boundary)):
        raise ValueError(f"{source}: public link to internal material: {href}")
    if target.name == "viewer.html" and url.query:
        query = parse_qs(url.query)
        paths = query.get("p", [])
        if len(paths) != 1 or not paths[0].endswith(".md"):
            raise ValueError(f"{source}: invalid viewer link: {href}")
        check_link(
            source,
            paths[0] + ("#" + url.fragment if url.fragment else ""),
            boundary,
            public,
        )
    if url.fragment and target.suffix == ".md":
        text = target.read_text()
        headings = re.findall(r"^#{1,6} (.+)$", text, re.MULTILINE)
        anchors = {
            re.sub(r"\s+", "-", re.sub(r"[^\w\s-]", "", h.lower())) for h in headings
        }
        anchors.update(re.findall(r'id="([^"]+)"', text))
        if unquote(url.fragment) not in anchors:
            raise ValueError(f"{source}: missing anchor: {href}")


def check_tree(root, boundary, public=False):
    assert root.is_dir(), "Documentation tree must exist"
    assert root.is_relative_to(boundary), "Tree must be inside its boundary"
    files = sorted(root.rglob("*"))
    if len(files) > MAX_FILES:
        raise ValueError(f"Too many documentation files: {root}")
    count = 0
    for source in files:
        if public and not is_public(source.relative_to(root)):
            continue
        if source.is_symlink():
            raise ValueError(f"Documentation must not contain symlinks: {source}")
        if source.suffix not in {".md", ".html"}:
            continue
        text = re.sub(
            r"^```[^\n]*\n.*?^```\s*$",
            "",
            source.read_text(),
            flags=re.MULTILINE | re.DOTALL,
        )
        text = re.sub(
            r"(<script\b[^>]*>).*?</script>", r"\1</script>", text, flags=re.DOTALL
        )
        links = re.findall(r"\[[^\]\n]*\]\(([^\s)]+)\)", text)
        links += re.findall(r'(?:href|src)="([^"\n]+)"', text)
        if len(links) > MAX_LINKS:
            raise ValueError(f"Too many links: {source}")
        for href in links:
            check_link(source, href, boundary, public)
        count += 1
    return count


def main():
    assert PUBLIC.is_dir(), "Public documentation source is missing"
    assert (REPO / "scripts/docs").is_dir(), "Checker must run from this repository"
    if len(sys.argv) > 2:
        raise ValueError("Usage: check.py [public-artifact-directory]")
    if len(sys.argv) == 2:
        site = Path(sys.argv[1]).resolve()
        files = sorted(site.rglob("*"))
        if not site.is_dir() or not files or len(files) > MAX_FILES:
            raise ValueError("Missing, empty, or oversized public artifact")
        forbidden = [p for p in files if not is_public(p.relative_to(site))]
        if forbidden:
            raise ValueError(
                f"Internal or unexpected files in public artifact: {forbidden}"
            )
        required = {
            "index.html",
            "viewer.html",
            "README.md",
            "CNAME",
            ".nojekyll",
            "assets/navigation.mjs",
        }
        if any(not (site / name).is_file() for name in required):
            raise ValueError(
                "Public artifact is missing a required entry point or asset"
            )
        if (site / "CNAME").read_text().strip() != "kanthord.kanthorlabs.com":
            raise ValueError("Incorrect public domain")
        count = check_tree(site, site, public=True)
        print(f"Public artifact: {count} pages checked; no internal files.")
        return
    count = check_tree(PUBLIC, PUBLIC, public=True)
    count += check_tree(PUBLIC / "brainstorm", REPO)
    count += check_tree(REPO / "engine/docs", REPO / "engine")
    for path in [
        REPO / "README.md",
        REPO / "engine/README.md",
        REPO / "engine/AGENTS.md",
    ]:
        links = re.findall(r"\[[^\]\n]*\]\(([^\s)]+)\)", path.read_text())
        if len(links) > MAX_LINKS:
            raise ValueError(f"Too many links: {path}")
        for href in links:
            check_link(path, href, REPO, False)
    print(f"Documentation: {count} pages checked across all three audiences.")


if __name__ == "__main__":
    main()

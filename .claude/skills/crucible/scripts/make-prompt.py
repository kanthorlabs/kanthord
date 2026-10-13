#!/usr/bin/env python3
import argparse
import re
import subprocess
import sys
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"
SLOT = re.compile(r"\{([a-z_]+)\}")


def fail(message):
    print(f"make-prompt: {message}", file=sys.stderr)
    sys.exit(2)


def repo_root():
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    if result.returncode != 0:
        fail("run it inside the git repository")
    return Path(result.stdout.strip())


def absolute(root, value):
    path = Path(value)
    return path if path.is_absolute() else root / path


def split_list(value):
    return [item.strip() for item in value.split(",") if item.strip()]


def page_lines(root, value, numbered):
    lines = []
    for index, item in enumerate(split_list(value), start=1):
        path, _, role = item.partition("=")
        full = absolute(root, path)
        if not full.is_file():
            fail(f"page not found: {full}")
        text = f"`{full}`"
        if role:
            text += f": {role}"
        lines.append(f"{index}. {text}" if numbered else f"- {text}")
    return "\n".join(lines)


def path_list(root, value, default):
    items = split_list(value) if value else [default]
    resolved = []
    for item in items:
        full = absolute(root, item)
        if not full.exists():
            fail(f"path not found: {full}")
        resolved.append(f"`{full}`")
    return ", ".join(resolved)


def block(file_value, intro):
    if not file_value:
        return ""
    path = Path(file_value)
    if not path.is_file():
        fail(f"file not found: {path}")
    head = f"{intro}\n\n" if intro else ""
    return f"\n\n{head}{path.read_text().strip()}"


def fill(template, slots):
    def replace(match):
        name = match.group(1)
        return slots[name] if name in slots else match.group(0)

    return SLOT.sub(replace, template)


def main():
    parser = argparse.ArgumentParser(
        usage="make-prompt.py verify|read --topic TOPIC --pages p1,p2,... "
        "[--base main] [--questions FILE] [--code PATHS] [--design PATHS] "
        "[--focus FILE] [--checks FILE]"
    )
    parser.add_argument("mode", choices=["verify", "read"])
    parser.add_argument("--topic", required=True)
    parser.add_argument("--pages", required=True)
    parser.add_argument("--base", default="main")
    parser.add_argument("--questions")
    parser.add_argument("--code")
    parser.add_argument("--design")
    parser.add_argument("--focus")
    parser.add_argument("--checks")
    args = parser.parse_args()

    root = repo_root()
    template = (TEMPLATES / f"{args.mode}.md").read_text()

    if args.mode == "read":
        if not args.questions:
            fail("read needs --questions FILE")
        questions = absolute(root, args.questions)
        if not questions.is_file():
            fail(f"questions file not found: {questions}")
        slots = {
            "topic": args.topic,
            "pages": page_lines(root, args.pages, True),
            "questions": f"`{questions}`",
        }
    else:
        slots = {
            "topic": args.topic,
            "pages": page_lines(root, args.pages, False),
            "worktree": str(root),
            "base": args.base,
            "code": path_list(root, args.code, "engine/src"),
            "design": path_list(root, args.design, "docs/brainstorm"),
            "reference": f"`{root / 'docs/reference'}`",
            "focus": block(args.focus, "Special attention to these risky claims:"),
            "checks": block(args.checks, "")
            or "\n\n(No list given. Derive the questions from the topic.)",
        }

    sys.stdout.write(fill(template, slots).rstrip() + "\n")


if __name__ == "__main__":
    main()

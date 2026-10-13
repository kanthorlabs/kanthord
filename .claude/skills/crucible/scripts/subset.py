#!/usr/bin/env python3
import re
import sys

ITEM = re.compile(r"^(\d+)\.\s")


def parse(text):
    items = {}
    current = None
    for line in text.splitlines():
        match = ITEM.match(line)
        if match:
            current = int(match.group(1))
            items[current] = [line]
        elif current is not None and line.strip():
            items[current].append(line)
    return items


def main():
    if len(sys.argv) != 3:
        print("Usage: subset.py QUESTIONS_FILE N1,N2,... > OUT", file=sys.stderr)
        sys.exit(2)
    try:
        numbers = [int(n) for n in sys.argv[2].split(",") if n.strip()]
        with open(sys.argv[1], encoding="utf-8") as handle:
            items = parse(handle.read())
    except (ValueError, OSError) as error:
        print(f"subset: {error}", file=sys.stderr)
        sys.exit(2)
    missing = [n for n in numbers if n not in items]
    if missing or not numbers:
        print(f"subset: question(s) not found: {missing}", file=sys.stderr)
        sys.exit(1)
    print("# Questions for the reader test (round 2)\n")
    for number in sorted(set(numbers)):
        print("\n".join(items[number]))


if __name__ == "__main__":
    main()

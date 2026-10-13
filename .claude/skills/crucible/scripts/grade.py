#!/usr/bin/env python3
import argparse
import re
import sys

BLOCK = re.compile(r"(?m)^[ \t>#*_-]*Q(\d+)\b")
FEEDBACK = re.compile(r"(?im)^[ \t#*_-]*general reading feedback")
LABEL = re.compile(
    r"(?im)(?:^|\s)(?:Q\d+\s+)?(answer|source|confidence|hard to find(?: or confusing)?)\s*:"
)
CONTRADICTION = re.compile(r"(?i)contradict|disagree|inconsisten|conflicting (?:statement|passage|information)")
KEY_ITEM = re.compile(r"^(\d+)\.\s+(.*)")


def read(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError as error:
        print(f"grade: {error}", file=sys.stderr)
        sys.exit(2)


def parse_key(text):
    key = {}
    current = None
    for line in text.splitlines():
        match = KEY_ITEM.match(line)
        if match:
            current = int(match.group(1))
            key[current] = match.group(2)
        elif current is not None and line.strip():
            key[current] += " " + line.strip()
    return key


def parse_answers(text):
    cut = FEEDBACK.search(text)
    if cut:
        text = text[: cut.start()]
    marks = list(BLOCK.finditer(text))
    answers = {}
    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        body = text[mark.start() : end].replace("**", "").replace("__", "")
        fields = {}
        labels = list(LABEL.finditer(body))
        for position, label in enumerate(labels):
            name = label.group(1).lower()
            stop = labels[position + 1].start() if position + 1 < len(labels) else len(body)
            value = " ".join(body[label.end() : stop].split()).strip(" /")
            fields.setdefault(name.split(" ")[0], value)
        answers[int(mark.group(1))] = fields
    return answers


def confidence_of(fields):
    match = re.search(r"(?i)\b(high|medium|low)\b", fields.get("confidence", ""))
    return match.group(1).lower() if match else "unknown"


def not_in_docs(answer):
    parts = re.split(r"(?<=[.;])\s+", answer)
    return " | ".join(p for p in parts if re.search(r"(?i)not in docs", p))


def cell(value):
    return value.replace("|", "\\|").replace("\n", " ") or " "


def main():
    parser = argparse.ArgumentParser(
        usage="grade.py --answers HAIKU_OUTPUT_FILE --key KEY_FILE --out GRADE_FILE "
        "[--questions ROUND_QUESTIONS_FILE]"
    )
    parser.add_argument("--answers", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--questions")
    args = parser.parse_args()

    key = parse_key(read(args.key))
    answers = parse_answers(read(args.answers))
    if args.questions:
        asked = set(parse_key(read(args.questions)))
        key = {n: text for n, text in key.items() if n in asked}
    if not key:
        print("grade: no numbered item in the key file", file=sys.stderr)
        sys.exit(1)
    if not answers:
        print("grade: no Q<n> block in the answers file", file=sys.stderr)
        sys.exit(1)

    rows = []
    review = []
    for number in sorted(key):
        fields = answers.get(number)
        if fields is None:
            rows.append((number, key[number], "", "none", "", "", "NO ANSWER"))
            review.append((number, "no answer"))
            continue
        answer = fields.get("answer", "")
        confidence = confidence_of(fields)
        missing = not_in_docs(answer)
        hard = fields.get("hard", "")
        reasons = []
        if confidence in ("low", "medium", "unknown"):
            reasons.append(f"confidence {confidence}")
        if missing or re.search(r"(?i)not in docs", answer):
            reasons.append("NOT IN DOCS")
        if CONTRADICTION.search(answer + " " + hard):
            reasons.append("contradiction reported")
        if not answer:
            reasons.append("empty answer")
        rows.append((number, key[number], answer, confidence, missing, hard, ""))
        if reasons:
            review.append((number, ", ".join(reasons)))
    extra = sorted(set(answers) - set(key))

    lines = ["# Grading sheet", ""]
    lines.append(
        f"{len(key)} question(s), {len(answers)} answered, {len(review)} must review."
    )
    lines.append("")
    lines.append("## Must review")
    lines.append("")
    if review:
        lines.extend(f"- Q{n}: {why}" for n, why in review)
    else:
        lines.append("- none")
    if extra:
        lines.append("")
        lines.append(f"Warning: answers without a key entry: {extra}")
    lines.append("")
    lines.append("## Grades")
    lines.append("")
    lines.append(
        "| Q | key | answer | confidence | NOT IN DOCS | hard to find | verdict | doc cause |"
    )
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for number, key_text, answer, confidence, missing, hard, note in rows:
        flag = f" {note}" if note else ""
        lines.append(
            "| "
            + " | ".join(
                [
                    str(number),
                    cell(key_text),
                    cell(answer + flag),
                    confidence,
                    cell(missing),
                    cell(hard),
                    " ",
                    " ",
                ]
            )
            + " |"
        )
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"grade: wrote {args.out}: {len(review)} of {len(key)} must review")


if __name__ == "__main__":
    main()

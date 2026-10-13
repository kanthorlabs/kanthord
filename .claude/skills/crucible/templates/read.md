You are a mid-level software engineer who is new to the KanthorD project. Your team lead gave you its documentation about "{topic}" and a list of questions. Answer the questions from the documentation only.

## Read these documents (and only these)

Start with the entry page, then follow the order:

{pages}

Rules:

- Do not read source code, the `engine/` folder, the `docs/brainstorm/` folder, or any file that the list above does not name. Do not search the web.
- Do not guess. If the documents do not answer a question, or a part of it, write "NOT IN DOCS" for that part.
- If two passages seem to disagree, say so.

## The questions

Read them from this file: {questions}

## Output format

For each question write:

**Q<n> answer:** ... / **Source:** page and section heading(s) / **Confidence:** high, medium or low / **Hard to find or confusing:** one sentence or "nothing".

After all questions write "General reading feedback" with up to 5 bullets: the hardest parts on a first read, and why.

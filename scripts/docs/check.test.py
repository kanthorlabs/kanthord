#!/usr/bin/env python3
"""Exercise the link scan of the documentation checker."""

import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "check", Path(__file__).resolve().parent / "check.py"
)
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


class LinkScanTest(unittest.TestCase):
    def scan(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / "page.md").write_text(text)
            return check.check_tree(root, root)

    def test_inline_code_holds_no_link(self):
        self.assertEqual(self.scan('The page carries `<base href="/">`.\n'), 1)
        self.assertEqual(self.scan("Write ``[a](missing.md)`` literally.\n"), 1)

    def test_link_outside_inline_code_is_checked(self):
        with self.assertRaisesRegex(ValueError, "broken link"):
            self.scan("See `code` and [a](missing.md).\n")
        with self.assertRaisesRegex(ValueError, "escapes documentation boundary"):
            self.scan('<a href="/">home</a>\n')


if __name__ == "__main__":
    unittest.main()

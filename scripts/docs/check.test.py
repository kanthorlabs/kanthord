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


class PublicPageTest(unittest.TestCase):
    def scan(self, href):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / "reference").mkdir()
            (root / "reference/page.html").write_text(f'<a href="{href}">a</a>\n')
            (root / "reference/target.html").write_text(
                '<h2 id="known">K</h2>\n<p data-id="other">O</p>\n'
            )
            (root / "reference/target.md").write_text("# Known\n")
            return check.check_tree(root, root, public=True)

    def test_html_anchor_comes_from_id(self):
        self.assertEqual(self.scan("target.html#known"), 2)
        with self.assertRaisesRegex(ValueError, "missing anchor"):
            self.scan("target.html#unknown")

    def test_public_page_never_links_to_markdown(self):
        with self.assertRaisesRegex(ValueError, "public link to Markdown"):
            self.scan("target.md")

    def test_data_id_is_no_anchor(self):
        with self.assertRaisesRegex(ValueError, "missing anchor"):
            self.scan("target.html#other")


class ViewerLinkTest(unittest.TestCase):
    def scan(self, href, public=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / "reference").mkdir()
            (root / "viewer.html").write_text("<p>moved</p>\n")
            (root / "reference/target.html").write_text('<h2 id="known">K</h2>\n')
            (root / "page.md").write_text(f"[a]({href})\n")
            (root / "reference/page.html").write_text(f'<a href="../{href}">a</a>\n')
            return check.check_tree(root, root, public=public)

    def test_internal_viewer_link_resolves_to_the_page(self):
        self.assertGreater(self.scan("viewer.html?p=reference/target.md#known"), 0)
        with self.assertRaisesRegex(ValueError, "missing anchor"):
            self.scan("viewer.html?p=reference/target.md#unknown")
        with self.assertRaisesRegex(ValueError, "broken link"):
            self.scan("viewer.html?p=reference/missing.md")
        with self.assertRaisesRegex(ValueError, "invalid viewer link"):
            self.scan("viewer.html?p=brainstorm/agent.md")

    def test_public_page_never_links_to_the_viewer(self):
        with self.assertRaisesRegex(ValueError, "public link to Markdown"):
            self.scan("viewer.html?p=reference/target.md", public=True)


if __name__ == "__main__":
    unittest.main()

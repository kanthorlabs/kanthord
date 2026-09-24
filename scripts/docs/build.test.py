#!/usr/bin/env python3
"""Exercise the Pages build without an engine checkout, including failure paths."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


class PublicBuildTest(unittest.TestCase):
    def test_publication_boundary(self):
        with tempfile.TemporaryDirectory(prefix="kanthord-pages-test-") as tmp:
            checkout = Path(tmp) / "repo"
            shutil.copytree(REPO / "docs", checkout / "docs")
            shutil.copytree(REPO / "scripts/docs", checkout / "scripts/docs")
            alias = Path(tmp) / "alias"
            alias.symlink_to(checkout, target_is_directory=True)
            build = alias / "scripts/docs/build.sh"
            artifact = Path(tmp) / "public"
            result = subprocess.run(
                [str(build), str(artifact)], capture_output=True, text=True, timeout=30
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((artifact / "brainstorm").exists())
            self.assertFalse((artifact / "serve.json").exists())
            self.assertTrue((artifact / "reference/gateway/verify.md").is_file())
            self.assertTrue((artifact / "reference/worker/register.md").is_file())
            self.assertFalse((artifact / "reference/api").exists())
            self.assertFalse((artifact / "reference/cli").exists())
            self.assertTrue((artifact / ".nojekyll").is_file())
            for destination in [artifact, alias / "docs/nested-output"]:
                rejected = subprocess.run(
                    [str(build), str(destination)],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                self.assertNotEqual(rejected.returncode, 0, str(destination))
                self.assertIn("Output directory", rejected.stderr)
            self.assertFalse((checkout / "docs/nested-output").exists())
            (artifact / "brainstorm").mkdir()
            rejected = subprocess.run(
                ["python3", str(checkout / "scripts/docs/check.py"), str(artifact)],
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("Internal or unexpected files", rejected.stderr)


if __name__ == "__main__":
    unittest.main()

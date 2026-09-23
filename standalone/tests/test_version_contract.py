from __future__ import annotations

import re
import tomllib
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
STANDALONE_ROOT = REPOSITORY_ROOT / "standalone"


class VersionContractTest(unittest.TestCase):
    def test_extension_and_standalone_versions_are_independent(self) -> None:
        project = tomllib.loads((REPOSITORY_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        extension_version = project["project"]["version"]
        backend_source = (REPOSITORY_ROOT / "backend" / "version.py").read_text(encoding="utf-8")
        match = re.search(r'^VERSION\s*=\s*"([^"]+)"', backend_source, re.MULTILINE)
        self.assertIsNotNone(match)
        self.assertRegex(extension_version, r"^\d+\.\d+\.\d+$")
        self.assertEqual(match.group(1), extension_version)

        standalone_version = (STANDALONE_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        self.assertRegex(standalone_version, r"^\d+\.\d+\.\d+$")
        self.assertNotEqual(standalone_version, extension_version)
        self.assertNotIn("standalone", project["project"]["name"].lower())

    def test_current_release_docs_match_standalone_version(self) -> None:
        version = (STANDALONE_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        for path in (REPOSITORY_ROOT / "README.md", STANDALONE_ROOT / "README.md", STANDALONE_ROOT / "RELEASE_NOTES.md"):
            self.assertIn(f"Prompt-Studio-Standalone-Windows-v{version}.zip", path.read_text(encoding="utf-8"), str(path))
        changelog = (STANDALONE_ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertEqual(re.search(r"^## ([\d.]+) -", changelog, re.MULTILINE).group(1), version)

    def test_registry_package_excludes_standalone_files(self) -> None:
        patterns = {
            line.strip()
            for line in (REPOSITORY_ROOT / ".comfyignore").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        self.assertIn("standalone/", patterns)
        self.assertIn("docs/dev/standalone/", patterns)
        self.assertIn("scripts/", patterns)
        self.assertIn("tests/", patterns)

    def test_release_builds_are_clean_and_preserve_user_settings(self) -> None:
        extension_build = (REPOSITORY_ROOT / "scripts" / "build_extension.ps1").read_text(encoding="utf-8")
        standalone_build = (REPOSITORY_ROOT / "scripts" / "build_standalone.ps1").read_text(encoding="utf-8")

        self.assertIn("ls-files", extension_build)
        self.assertIn("core.excludesFile", extension_build)
        self.assertIn("AllowDirty", extension_build)
        self.assertIn("AllowDirty", standalone_build)
        self.assertIn("ls-files", standalone_build)
        self.assertIn('"settings.example.json"', standalone_build)
        self.assertNotIn('(Join-Path $dataTarget "settings.json")', standalone_build)

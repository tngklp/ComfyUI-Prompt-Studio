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
        # The Standalone build reads its copy list from the manifest instead of
        # keeping a private list that silently drifts from the project.
        self.assertIn("package.manifest.json", standalone_build)
        self.assertNotIn('@("start.bat", "requirements.txt"', standalone_build)

    def _load_manifest(self) -> dict:
        import json

        return json.loads((STANDALONE_ROOT / "package.manifest.json").read_text(encoding="utf-8"))

    def test_manifest_lists_only_paths_that_exist(self) -> None:
        manifest = self._load_manifest()
        self.assertEqual(manifest["schema_version"], 1)
        for relative in manifest["app"]["files"]:
            self.assertTrue((STANDALONE_ROOT / relative).is_file(), f"app file missing: {relative}")
        for relative in manifest["app"]["trees"]:
            self.assertTrue((STANDALONE_ROOT / relative).is_dir(), f"app tree missing: {relative}")
        for relative in manifest["upstream"]["trees"]:
            self.assertTrue((REPOSITORY_ROOT / relative).is_dir(), f"upstream tree missing: {relative}")
        for relative in manifest["upstream"]["files"]:
            self.assertTrue((REPOSITORY_ROOT / relative).is_file(), f"upstream file missing: {relative}")
        self.assertTrue((STANDALONE_ROOT / manifest["app"]["data_example"]).is_file())

    def test_manifest_upstream_satisfies_host_validation(self) -> None:
        """The vendored upstream must satisfy validate_upstream()'s own contract."""
        from prompt_studio.config import validate_upstream

        manifest = self._load_manifest()
        trees = manifest["upstream"]["trees"]
        files = set(manifest["upstream"]["files"])

        def shipped(relative: str) -> bool:
            """True when the relative path ships as a standalone file or inside a tree."""
            if relative in files:
                return True
            return any(relative == tree or relative.startswith(f"{tree}/") for tree in trees)

        # validate_upstream() rejects a checkout missing any of these.
        for marker in ("backend/routes.py", "web/main.js", "web/target_registry.js", "targets.json"):
            self.assertTrue(shipped(marker), f"manifest must ship {marker}")

        for relative in manifest["upstream"]["required"]:
            self.assertTrue(shipped(relative), f"required entry not shipped: {relative}")

        # Prove it against the real checkout: the host accepts the repo root, whose
        # layout mirrors what the ZIP vendors.
        validate_upstream(REPOSITORY_ROOT)

    def test_manifest_keeps_user_settings_out_of_the_package(self) -> None:
        manifest = self._load_manifest()
        self.assertEqual(manifest["app"]["data_example"], "data/settings.example.json")
        self.assertNotIn("data/settings.json", manifest["app"]["files"])

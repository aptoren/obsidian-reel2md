from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROOT_MANIFEST = ROOT / "manifest.json"
PLUGIN_MANIFEST = ROOT / "plugin" / "manifest.json"


class ManifestSyncTests(unittest.TestCase):
    def test_root_and_plugin_manifests_are_identical(self) -> None:
        self.assertTrue(ROOT_MANIFEST.is_file(), "root manifest.json is required")
        self.assertTrue(PLUGIN_MANIFEST.is_file(), "plugin/manifest.json is required")
        self.assertEqual(
            ROOT_MANIFEST.read_bytes(),
            PLUGIN_MANIFEST.read_bytes(),
            "root and plugin manifests must stay byte-for-byte identical",
        )

    def test_manifest_identifier_is_community_compatible(self) -> None:
        manifest = json.loads(ROOT_MANIFEST.read_text(encoding="utf-8"))
        plugin_id = manifest["id"]

        self.assertEqual(plugin_id, "reel-to-md")
        self.assertRegex(plugin_id, r"^[a-z-]+$")
        self.assertNotIn("obsidian", plugin_id)
        self.assertFalse(plugin_id.endswith("plugin"))
        self.assertEqual(manifest["version"], "0.1.2")
        self.assertTrue(manifest["isDesktopOnly"])


if __name__ == "__main__":
    unittest.main()

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "moci-app-docker" / "files"

class CatalogueExpansionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.apps = json.loads((ROOT / "app-catalog.json").read_text())["apps"]

    def test_minimum_catalogue(self):
        self.assertGreaterEqual(len(self.apps), 65)
        self.assertEqual(len({a["id"] for a in self.apps}), len(self.apps))

    def test_office_and_home_options(self):
        self.assertTrue(any(a.get("profile") == "office" for a in self.apps))
        self.assertTrue(any(a.get("profile") == "home" for a in self.apps))
        self.assertTrue(any(a.get("profile") == "both" for a in self.apps))

    def test_reference_article_apps_covered(self):
        required = {
            "homepage", "home-assistant", "plex", "jellyfin",
            "nextcloud", "portainer", "pihole", "nginx-proxy-manager", "watchtower",
            "duplicati", "openspeedtest", "tautulli", "audiobookshelf",
            "immich", "netdata", "fail2ban", "dashy",
        }
        self.assertFalse(required - {a["id"] for a in self.apps})

    def test_new_apps_not_installable(self):
        supported = {"adguard-home", "uptime-kuma"}
        for app in self.apps:
            if app["id"] not in supported:
                self.assertFalse(app["template_available"], app["id"])

    def test_risky_apps_marked(self):
        by_id = {a["id"]: a for a in self.apps}
        for id in ("pihole", "fail2ban", "watchtower", "netdata", "portainer"):
            self.assertNotEqual(by_id[id]["risk"], "review")

    def test_required_metadata(self):
        for app in self.apps:
            self.assertTrue(all(app.get(k) for k in ("id","name","category","repository","description","profile","complexity","risk")))
            self.assertIn(app["profile"], ("home","office","both"))

if __name__ == "__main__":
    unittest.main()

import importlib.machinery
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "moci-app-docker" / "files" / "moci-docker-api"
loader = importlib.machinery.SourceFileLoader("moci_rc_api", str(SOURCE))
spec = importlib.util.spec_from_loader(loader.name, loader)
api = importlib.util.module_from_spec(spec)
loader.exec_module(api)


class ReleaseCandidateSecurity(unittest.TestCase):
    def test_deployments_default_off_and_mode_protected(self):
        with tempfile.TemporaryDirectory() as root:
            marker = Path(root) / "enable-deployments"
            with patch.object(api, "ENABLE_FILE", str(marker)):
                self.assertFalse(api.writes_enabled())
                marker.write_text("enabled\n")
                marker.chmod(0o666)
                self.assertFalse(api.writes_enabled())
                marker.chmod(0o600)
                if os.geteuid() == 0:
                    self.assertTrue(api.writes_enabled())
                else:
                    self.assertFalse(api.writes_enabled())

    def test_denies_unmanaged_container_and_unsupported_actions(self):
        with patch.object(api, "docker", return_value={"Config": {"Labels": {}}}) as docker:
            with self.assertRaisesRegex(ValueError, "Only MoCI-managed"):
                api.managed_container_action("a" * 12, "stop")
            docker.assert_called_once()
        with self.assertRaisesRegex(ValueError, "Unknown container action"):
            api.managed_container_action("a" * 12, "delete")
        with self.assertRaisesRegex(ValueError, "Invalid Docker identifier"):
            api.managed_container_action("../docker.sock", "stop")

    def test_managed_action_endpoint_is_fixed(self):
        with patch.object(api, "docker", return_value={"Config": {"Labels": {"com.moci.managed": "true"}}}):
            with patch.object(api, "docker_no_reply", return_value={"ok": True}) as send:
                result = api.managed_container_action("b" * 12, "restart")
        self.assertTrue(result["ok"])
        send.assert_called_once_with("POST", "/containers/" + "b" * 12 + "/restart?t=10")

    def test_compose_marks_its_own_containers(self):
        image = "example/safe@sha256:" + "a" * 64
        with patch.object(api, "policy", return_value={image}):
            spec = api.spec_validate({"services": {"web": {"image": image}}})
        self.assertEqual(spec["services"]["web"]["labels"], {"com.moci.managed": "true"})
        self.assertTrue(spec["services"]["web"]["read_only"])

    def test_unauthorized_writes_fail_closed(self):
        with patch.object(api, "writes_enabled", return_value=False):
            for method in api.WRITE_METHODS:
                with self.assertRaisesRegex(ValueError, "disabled"):
                    api.run(method, {})

    def test_catalog_does_not_claim_unsupported_app_ready(self):
        catalog = {"schema": 1, "apps": [
            {"id": "safe", "name": "Safe", "repository": "example/safe", "template_available": True, "complexity": "easy", "risk": "review"},
            {"id": "critical", "name": "Critical", "repository": "example/critical", "template_available": True, "complexity": "medium", "risk": "router-critical"},
        ]}
        from unittest.mock import mock_open
        import json
        with tempfile.TemporaryDirectory() as root:
            Path(root, "app-catalog.json").write_text(json.dumps(catalog))
            Path(root, "allowed-images.json").write_text(json.dumps({"images": [
                "example/safe@sha256:" + "a" * 64, "example/critical@sha256:" + "b" * 64]}))
            Path(root, "app-templates.json").write_text(json.dumps({"schema": 1, "templates": {"safe": {"repository": "example/safe"}}}))
            Path(root, "app-pins.json").write_text(json.dumps({
                "safe": "example/safe@sha256:" + "a" * 64,
                "critical": "example/critical@sha256:" + "b" * 64}))
            with patch.object(api, "ROOT", root):
                with patch.object(api, "writes_enabled", return_value=True):
                    result = api.catalog()["catalog"]
        self.assertTrue(result[0]["ready"])
        self.assertFalse(result[1]["ready"])


if __name__ == "__main__":
    unittest.main()

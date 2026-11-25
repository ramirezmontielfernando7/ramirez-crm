"""The AI can submit structured requests, never an arbitrary GitHub operation."""
import copy
import unittest

from broker import handle
from mcp_server import respond
from verify import BRANCH, BUILD, REPO


class FakeGitHub:
    def __init__(self):
        self.calls = []
        self.control = "a" * 40
        self.source = "b" * 40
        self.run = dict(id=101, status="completed", conclusion="success", run_attempt=1,
                        event="workflow_dispatch", head_branch=BRANCH, head_sha=self.control, path=BUILD,
                        repository={"full_name": REPO, "id": 1}, head_repository={"full_name": REPO, "id": 1},
                        display_title=f"Expo codex/dashfort-mobile-test {self.source} 0.2.3 14 demo live")
        self.artifact = dict(id=201, name="dashfort-live-unsigned-101", size_in_bytes=301, expired=False,
                             digest="sha256:" + "c" * 64, workflow_run=dict(id=101, head_branch=BRANCH,
                             head_sha=self.control, repository_id=1, head_repository_id=1))

    def call(self, path, method="GET", data=None):
        self.calls.append((path, method, data))
        if path == "actions/runs/101":
            return copy.deepcopy(self.run)
        if path == "actions/artifacts/201":
            return copy.deepcopy(self.artifact)
        if path == "actions/runs/101/artifacts?per_page=100":
            return {"artifacts": [copy.deepcopy(self.artifact)]}
        if path == f"git/ref/heads/{BRANCH}":
            return {"object": {"sha": self.control}}
        if method == "POST":
            return {}
        raise AssertionError("unexpected GitHub read")


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeGitHub()
        self.release = dict(source_sha=self.api.source, version="0.2.3", version_code="14", profile="demo")
        self.sign = dict(self.release, build_run_id="101", artifact_id="201", apk_sha256="f" * 64)

    def test_dispatch_is_pinned(self):
        handle(self.api, "request_build", dict(self.release, source_branch="codex/dashfort-mobile-test"))
        build = self.api.calls[-1]
        self.assertEqual(build[:2], ("actions/workflows/mobile-expo-build.yml/dispatches", "POST"))
        self.assertEqual(build[2]["ref"], BRANCH)
        handle(self.api, "request_sign", self.sign)
        sign = self.api.calls[-1]
        self.assertEqual(sign[:2], ("actions/workflows/mobile-expo-sign.yml/dispatches", "POST"))
        self.assertEqual(sign[2]["inputs"]["mode"], "live")

    def test_refuses_outside_operations(self):
        for operation, args in [
            ("workflow_dispatch", dict(workflow="android.yml")),
            ("request_build", dict(self.release, source_branch="main")),
            ("request_build", dict(self.release, source_branch="codex/dashfort-mobile-test", ref="main")),
            ("request_sign", dict(self.sign, artifact_id="../secrets")),
            ("status", dict(run_id="101/../../secrets")),
        ]:
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                handle(self.api, operation, args)
        self.assertEqual(self.api.calls, [])

    def test_refuses_twa_and_wrong_artifact(self):
        self.api.run["path"] = ".github/workflows/android.yml"
        for operation in ("status", "cancel", "artifacts"):
            with self.assertRaises(ValueError):
                handle(self.api, operation, {"run_id": "101"})
        self.api.run["path"] = BUILD
        self.api.artifact["workflow_run"]["id"] = 999
        with self.assertRaises(ValueError):
            handle(self.api, "request_sign", self.sign)
        self.assertFalse(any(method == "POST" for _, method, _ in self.api.calls))

    def test_mcp_scope(self):
        request = {"jsonrpc": "2.0", "id": 1}
        listing = respond(self.api, dict(request, method="tools/list"))["result"]["tools"]
        self.assertEqual({tool["name"] for tool in listing},
                         {"request_build", "request_sign", "list_runs", "status", "artifacts"})
        forbidden = respond(self.api, dict(request, method="tools/call",
                                          params={"name": "request", "arguments": {"url": "https://example.test"}}))
        self.assertTrue(forbidden["result"]["isError"])
        self.assertEqual(self.api.calls, [])

    def test_status_artifacts_and_cancel(self):
        self.assertEqual(handle(self.api, "status", {"run_id": "101"})["conclusion"], "success")
        self.assertEqual(handle(self.api, "artifacts", {"run_id": "101"})["artifacts"][0]["id"], 201)
        with self.assertRaises(ValueError):
            handle(self.api, "cancel", {"run_id": "101"})
        self.api.run["status"] = "waiting"
        handle(self.api, "cancel", {"run_id": "101"})
        self.assertEqual(self.api.calls[-1][:2], ("actions/runs/101/cancel", "POST"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

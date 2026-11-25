import hashlib
import io
import json
import os
import unittest
from unittest.mock import patch

import http_host
from test_broker import FakeGitHub


class HostTests(unittest.TestCase):
    def setUp(self):
        import secrets
        self.agent = secrets.token_hex(32)
        self.operator = secrets.token_hex(32)
        self.settings = {"DASHFORT_MCP_CLIENTS": json.dumps([
            {"token_sha256": hashlib.sha256(token.encode()).hexdigest(), "role": role}
            for token, role in ((self.agent, "agent"), (self.operator, "operator"))])}
        self.api = FakeGitHub()

    def rpc(self, token, method, **params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        statuses = []
        request = dict(PATH_INFO="/mcp", REQUEST_METHOD="POST", CONTENT_TYPE="application/json",
                       CONTENT_LENGTH=str(len(body)), HTTP_AUTHORIZATION="Bearer " + token)
        request["wsgi.input"] = io.BytesIO(body)
        with patch.dict(os.environ, self.settings), patch.object(http_host, "GitHub", return_value=self.api):
            response = http_host.app(request, lambda status, headers: statuses.append(status))
        return int(statuses[0].split()[0]), json.loads(response[0]) if response[0] else None

    def test_auth_and_revocation(self):
        self.assertEqual(self.rpc(self.agent, "tools/list")[0], 200)
        self.settings = {"DASHFORT_MCP_CLIENTS": json.dumps([
            {"token_sha256": hashlib.sha256(self.operator.encode()).hexdigest(), "role": "operator"}])}
        self.assertEqual(self.rpc(self.agent, "tools/list")[0], 401)
        self.assertEqual(self.api.calls, [])

    def test_role_restricts_cancel(self):
        self.api.run["status"] = "waiting"
        self.assertTrue(self.rpc(self.agent, "tools/call", name="cancel", arguments={"run_id": "101"})[1]["result"]["isError"])
        self.assertEqual(self.api.calls, [])
        status, payload = self.rpc(self.operator, "tools/call", name="cancel", arguments={"run_id": "101"})
        self.assertEqual(status, 200)
        self.assertNotIn("isError", payload["result"])
        self.assertEqual(self.api.calls[-1][:2], ("actions/runs/101/cancel", "POST"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

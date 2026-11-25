"""Bootstrap safety with a fake GitHub API. The tests make no writes to GitHub."""
import copy
import unittest

from bootstrap import BRANCH_POLICY, BRANCH_REF, ENV_CONFIG, FREEZE, configure
from verify import LAB_ENVIRONMENT, OWNER_ID, REPO, SIGNING_ENVIRONMENT


class FakeAdmin:
    def __init__(self):
        self.sha = "a" * 40
        self.calls = []
        self.env = {}
        self.policies = []
        self.ruleset = None

    def call(self, path, method="GET", data=None):
        self.calls.append((path, method))
        if path == "":
            return {"full_name": REPO, "default_branch": "main"}
        if path.startswith("git/ref/heads/"):
            return {"ref": BRANCH_REF, "object": {"sha": self.sha}}
        if path == "environments?per_page=100":
            return {"environments": [{"name": name} for name in self.env]}
        if path == "rulesets?includes_parents=false&per_page=100":
            return [self.ruleset] if self.ruleset else []
        if path == "rulesets" and method == "POST":
            self.ruleset = dict(copy.deepcopy(data), id=10)
            return self.ruleset
        if path == "rulesets/10":
            return self.ruleset
        if path.startswith("rules/branches/"):
            return self.ruleset["rules"] if self.ruleset else []
        if path.startswith("environments/"):
            name = path.split("/")[1]
            if method == "PUT":
                self.env[name] = {
                    **copy.deepcopy(data),
                    "protection_rules": [{"type": "required_reviewers", "prevent_self_review": True,
                                          "reviewers": [{"type": "User", "reviewer": {"id": OWNER_ID}}]}],
                }
            if method == "POST":
                self.policies.append(data)
            if "deployment-branch-policies" in path:
                return {"branch_policies": self.policies}
            return self.env[name]
        raise AssertionError(f"Unexpected API: {path}")


class BootstrapTests(unittest.TestCase):
    def test_dry_run_cannot_mutate(self):
        api = FakeAdmin()
        plan = configure(api, api.sha, "live", False)
        self.assertFalse(plan["applied"])
        self.assertIn("freeze_audited_control_branch", plan["operations"])
        self.assertTrue(all(method == "GET" for _, method in api.calls))

    def test_live_freezes_only_the_audited_branch_and_is_idempotent(self):
        api = FakeAdmin()
        configure(api, api.sha, "live", True)
        self.assertEqual(api.ruleset["conditions"], FREEZE["conditions"])
        self.assertEqual(set(api.env), {SIGNING_ENVIRONMENT})
        self.assertEqual(api.policies, [BRANCH_POLICY])
        self.assertEqual(configure(api, api.sha, "live", True)["operations"], [])

    def test_lab_has_no_ruleset_and_rejects_wrong_sha(self):
        api = FakeAdmin()
        with self.assertRaises(ValueError):
            configure(api, "b" * 40, "lab", True)
        self.assertTrue(all(method == "GET" for _, method in api.calls))
        configure(api, api.sha, "lab", True)
        self.assertEqual(set(api.env), {LAB_ENVIRONMENT})
        self.assertIsNone(api.ruleset)

    def test_refuses_policy_drift_without_writes(self):
        api = FakeAdmin()
        configure(api, api.sha, "lab", True)
        api.env[LAB_ENVIRONMENT]["deployment_branch_policy"] = dict(ENV_CONFIG["deployment_branch_policy"])
        api.env[LAB_ENVIRONMENT]["can_admins_bypass"] = True
        api.calls.clear()
        with self.assertRaises(ValueError):
            configure(api, api.sha, "lab", True)
        self.assertTrue(all(method == "GET" for _, method in api.calls))


if __name__ == "__main__":
    unittest.main(verbosity=2)

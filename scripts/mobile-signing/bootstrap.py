"""One-time, no-secret GitHub provisioning. Run from an approved admin host."""
import argparse
import json
import os
import re
import sys
from urllib.parse import quote

from broker import GitHub
from verify import BRANCH, LAB_ENVIRONMENT, OWNER_ID, REPO, SIGNING_ENVIRONMENT, need

RULESET = "Dashfort Mobile signing control freeze"
BRANCH_REF = f"refs/heads/{BRANCH}"
FREEZE = {
    "name": RULESET,
    "target": "branch",
    "enforcement": "active",
    "bypass_actors": [],
    "conditions": {"ref_name": {"include": [BRANCH_REF], "exclude": []}},
    "rules": [{"type": name} for name in ("creation", "update", "deletion", "non_fast_forward")],
}
ENV_CONFIG = {
    "wait_timer": 0,
    "prevent_self_review": True,
    "can_admins_bypass": False,
    "reviewers": [{"type": "User", "id": OWNER_ID}],
    "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True},
}
BRANCH_POLICY = {"name": BRANCH, "type": "branch"}


def environment_policy(environment):
    required = [rule for rule in environment.get("protection_rules", []) if rule.get("type") == "required_reviewers"]
    expected = [{"type": "User", "id": OWNER_ID}]
    actual = [{"type": r.get("type"), "id": (r.get("reviewer") or {}).get("id")}
              for r in (required[0].get("reviewers") or [])] if len(required) == 1 else []
    need(environment.get("can_admins_bypass") is False and len(required) == 1 and
         required[0].get("prevent_self_review") is True and actual == expected and
         environment.get("deployment_branch_policy") == ENV_CONFIG["deployment_branch_policy"],
         "El entorno existente tiene una política distinta. Requiere revisión administrativa.")


def check_freeze(ruleset):
    need(all(ruleset.get(field) == FREEZE[field] for field in ("name", "target", "enforcement", "conditions", "bypass_actors"))
         and {rule.get("type") for rule in ruleset.get("rules", [])} == {rule["type"] for rule in FREEZE["rules"]},
         "El ruleset existente no congela únicamente la rama de control aprobada.")


def exact_ref(api, sha):
    needed = api.call(f"git/ref/heads/{BRANCH}")
    need(needed.get("ref") == BRANCH_REF and (needed.get("object") or {}).get("sha") == sha,
         "La rama remota no coincide con el commit auditado.")


def configure(api, sha, mode, apply):
    need(mode in ("lab", "live"), "Modo administrativo inválido.")
    need(re.fullmatch(r"[0-9a-f]{40}", sha), "Se requiere el SHA auditado completo.")
    repo = api.call("")
    need(repo.get("full_name") == REPO and repo.get("default_branch") == "main",
         "Repositorio o rama predeterminada inesperados.")
    exact_ref(api, sha)
    environment = LAB_ENVIRONMENT if mode == "lab" else SIGNING_ENVIRONMENT
    env_endpoint = f"environments/{environment}"
    current_names = {env["name"] for env in api.call("environments?per_page=100").get("environments", [])}
    create_env = environment not in current_names
    plan = {"repository": REPO, "branch": BRANCH, "audited_sha": sha, "environment": environment,
            "applied": apply, "operations": []}

    # Check drift before mutating anything. Never rewrite a foreign policy,
    # even if it looks close to the proposed one.
    policies = []
    if not create_env:
        environment_policy(api.call(env_endpoint))
        policies = api.call(env_endpoint + "/deployment-branch-policies?per_page=100").get("branch_policies", [])
        need(not policies or [{k: p.get(k) for k in BRANCH_POLICY} for p in policies] == [BRANCH_POLICY],
             "Hay políticas de rama ajenas en el entorno. Se requiere una revisión administrativa.")
    else:
        plan["operations"].append("create_environment")
    if not policies:
        plan["operations"].append("allow_exact_control_branch")
    if mode == "live":
        matches = [rule for rule in api.call("rulesets?includes_parents=false&per_page=100") if rule.get("name") == RULESET]
        need(len(matches) <= 1, "Hay varias reglas de firma con el mismo nombre.")
        if matches:
            check_freeze(api.call(f"rulesets/{matches[0]['id']}"))
        else:
            plan["operations"].insert(0, "freeze_audited_control_branch")

    if apply:
        if "freeze_audited_control_branch" in plan["operations"]:
            created = api.call("rulesets", "POST", FREEZE)
            check_freeze(api.call(f"rulesets/{created['id']}"))
        if mode == "live":
            exact_ref(api, sha)
            enforced = api.call("rules/branches/" + quote(BRANCH, safe=""))
            need({"update", "deletion", "non_fast_forward"} <= {rule["type"] for rule in enforced},
                 "GitHub no confirma que la rama quede congelada.")
        if create_env:
            api.call(env_endpoint, "PUT", ENV_CONFIG)
        environment_policy(api.call(env_endpoint))
        if not policies:
            api.call(env_endpoint + "/deployment-branch-policies", "POST", BRANCH_POLICY)
        final = api.call(env_endpoint + "/deployment-branch-policies?per_page=100").get("branch_policies", [])
        need([{k: p.get(k) for k in BRANCH_POLICY} for p in final] == [BRANCH_POLICY],
             "GitHub no confirma la política exacta de rama.")
        exact_ref(api, sha)
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("lab", "live"), required=True)
    parser.add_argument("--audited-sha", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        api = GitHub(os.environ.pop("DASHFORT_ADMIN_PROVISIONING_TOKEN", ""))
        print(json.dumps(configure(api, args.audited_sha, args.mode, args.apply), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, AttributeError) as error:
        print(str(error) if type(error) is ValueError else "GitHub devolvió metadatos inesperados.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

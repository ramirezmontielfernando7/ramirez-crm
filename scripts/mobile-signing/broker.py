"""Restricted GitHub transport for a trusted agent tool host, without shell access.

Run inside the trusted deployment boundary. The AI sees named tool operations
and structured results. The host owns the GitHub transport credential.
"""
import json
import re
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from verify import BRANCH, BUILD, REPO, need, positive_id, valid_release, verify_run

SIGN = ".github/workflows/mobile-expo-sign.yml"
SOURCE_KEYS = {"source_branch", "source_sha", "version", "version_code", "profile"}
SIGN_KEYS = {"build_run_id", "artifact_id", "apk_sha256", "source_sha", "version", "version_code", "profile"}
OPERATIONS = ("request_build", "request_sign", "status", "artifacts", "list_runs", "cancel")

# URL boundary applies even when a compromised or misconfigured API redirects.
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class GitHub:
    def __init__(self, token):
        need(isinstance(token, str) and token, "Falta credencial del ejecutor.")
        self.token = token
        self.opener = build_opener(NoRedirect)

    def call(self, path, method="GET", data=None):
        url = f"https://api.github.com/repos/{REPO}/{path}"
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                   "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "dashfort-mobile-requests"}
        payload = None
        if data is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(data).encode()
        try:
            with self.opener.open(Request(url, headers=headers, data=payload, method=method), timeout=25) as response:
                raw = response.read(8 * 1024 * 1024)
            return json.loads(raw) if raw else None
        except (HTTPError, OSError, ValueError) as error:
            status = error.code if isinstance(error, HTTPError) else "no disponible"
            raise ValueError(f"GitHub rechazó la operación ({status}).") from None


def fields(args, allowed):
    need(isinstance(args, dict) and set(args) == allowed and
         all(type(v) is str and 0 < len(v) <= 180 for v in args.values()), "Campos inesperados.")


def allowed_run(run):
    return (isinstance(run, dict) and type(run.get("id")) is int and
         run.get("path") in (BUILD, SIGN) and run.get("head_branch") == BRANCH and
         run.get("event") == "workflow_dispatch" and run.get("run_attempt") == 1 and
         (run.get("repository") or {}).get("full_name") == REPO and
         (run.get("head_repository") or {}).get("full_name") == REPO)


def scoped_run(api, run_id):
    positive_id(run_id)
    run = api.call(f"actions/runs/{run_id}")
    need(allowed_run(run) and run["id"] == int(run_id), "La ejecución no pertenece al canal móvil autorizado.")
    return run


def run_summary(run):
    title = run.get("display_title") or ""
    clean_title = re.fullmatch(r"Expo codex/dashfort-mobile-[a-z0-9-]{1,100} [0-9a-f]{40} [0-9.]{1,18} [0-9]{1,10} (demo|production) (lab|live)",
                              title) if run["path"] == BUILD else None
    return {"id": run["id"], "url": f"https://github.com/{REPO}/actions/runs/{run['id']}",
            "status": run.get("status"), "conclusion": run.get("conclusion"),
            "control_sha": run.get("head_sha"), "title": title if clean_title else None}


def scoped_artifacts(api, run):
    current = str(run["id"])
    prefix = "dashfort-live-unsigned-" if run["path"] == BUILD else "dashfort-signed-"
    response = api.call(f"actions/runs/{current}/artifacts?per_page=100")
    rows = []
    for a in response.get("artifacts", []):
        origin = a.get("workflow_run") or {}
        # The listing is scoped by run. When metadata includes the association,
        # require it to agree, and revalidate the individual artifact at signing.
        if (a.get("name") == prefix + current and a.get("expired") is False and type(a.get("id")) is int
                and (not origin or origin.get("id") == run["id"])):
            archive_digest = a.get("digest") or ""
            if not re.fullmatch(r"sha256:[0-9a-f]{64}", archive_digest):
                continue
            rows.append({"id": a["id"], "name": a["name"], "archive_digest": archive_digest,
                         "url": f"https://github.com/{REPO}/actions/runs/{current}/artifacts/{a['id']}"})
    return rows


def handle(api, operation, args):
    need(operation in OPERATIONS, "Operación fuera del alcance.")
    if operation in ("request_build", "request_sign"):
        if operation == "request_build":
            fields(args, SOURCE_KEYS)
            branch = args["source_branch"]
            workflow = BUILD
        else:
            fields(args, SIGN_KEYS)
            branch = "codex/dashfort-mobile-request"
            workflow = SIGN
            positive_id(args["artifact_id"])
            need(re.fullmatch(r"[0-9a-f]{64}", args["apk_sha256"]), "SHA-256 inválido.")
        valid_release(branch, args["source_sha"], args["version"], args["version_code"], args["profile"])
        if operation == "request_sign":
            run = scoped_run(api, args["build_run_id"])
            need(run.get("path") == BUILD and run.get("status") == "completed" and
                 run.get("conclusion") == "success", "Se requiere una compilación finalizada.")
            # Use the individual artifact for the authoritative metadata.
            artifact = api.call(f"actions/artifacts/{args['artifact_id']}")
            current_ref = api.call(f"git/ref/heads/{BRANCH}")["object"]["sha"]
            verify_run(run, artifact, current_ref, args["build_run_id"], args["artifact_id"], args["source_sha"],
                       args["version"], args["version_code"], args["profile"])
        result = api.call(f"actions/workflows/{workflow.rsplit('/', 1)[-1]}/dispatches", "POST",
                          {"ref": BRANCH, "inputs": {**args, "mode": "live"}})
        return {"accepted": True, "run_id": result.get("workflow_run_id") if isinstance(result, dict) else None,
                "runs": f"https://github.com/{REPO}/actions/workflows/{workflow.rsplit('/', 1)[-1]}"}
    if operation == "list_runs":
        fields(args, {"kind"})
        need(args["kind"] in ("build", "sign"), "Tipo de ejecución desconocido.")
        workflow = BUILD if args["kind"] == "build" else SIGN
        name = workflow.rsplit("/", 1)[-1]
        data = api.call(f"actions/workflows/{name}/runs?branch={BRANCH}&event=workflow_dispatch&per_page=20")
        return {"runs": [run_summary(run) for run in data.get("workflow_runs", [])
                         if allowed_run(run) and run["path"] == workflow]}
    fields(args, {"run_id"})
    run = scoped_run(api, args["run_id"])
    run_link = f"https://github.com/{REPO}/actions/runs/{run['id']}"
    if operation == "status":
        return run_summary(run)
    if operation == "artifacts":
        return {"run": run_link, "artifacts": scoped_artifacts(api, run)}
    # Cancellation applies only to an active mobile run, never to a deploy or TWA.
    need(run.get("status") in ("queued", "waiting", "requested", "pending", "in_progress"),
         "La ejecución ya terminó.")
    api.call(f"actions/runs/{run['id']}/cancel", "POST")
    return {"accepted": True, "run": run_link}

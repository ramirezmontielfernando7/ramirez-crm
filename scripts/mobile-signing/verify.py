"""Validate Dashfort signing inputs. All error strings are safe for public logs."""
import argparse
import hashlib
import json
import re
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath

REPO = "ramirezmontielfernando7/ramirez-crm"
BRANCH = "codex/dashfort-mobile-signing-20261125"
BUILD = ".github/workflows/mobile-expo-build.yml"
PACKAGE = "com.demfort.dashfort.dev"
MAX_APK = 180 * 1024 * 1024
OWNER_ID = 332673809
SIGNING_ENVIRONMENT = "dashfort-mobile-signing"
LAB_ENVIRONMENT = "dashfort-mobile-signing-lab"
LAB_BRANCH = "codex/dashfort-mobile-c10-20261122"
LAB_SOURCE = "877646e55d9809a5963127426a2834534183983c"
FINGERPRINT = "0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b"


def need(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def valid_release(branch, sha, version, code, profile, mode="live"):
    need(re.fullmatch(r"codex/dashfort-mobile-[a-z0-9-]{1,100}", branch) and branch != BRANCH,
         "Rama fuente no autorizada.")
    need(re.fullmatch(r"[0-9a-f]{40}", sha), "El commit debe ser un SHA completo.")
    need(re.fullmatch(r"[0-9]{1,5}(\.[0-9]{1,5}){2}", version), "Versión inválida.")
    need(mode in ("lab", "live"), "Modo inválido.")
    if mode == "lab":
        need((branch, sha, version, code, profile) == (LAB_BRANCH, LAB_SOURCE, "0.2.2", "13", "demo"),
             "El laboratorio solo permite el commit y perfil de control.")
        return
    need(re.fullmatch(r"[1-9][0-9]{0,9}", code) and 13 < int(code) <= 2100000000,
         "versionCode debe superar al de 0.2.2 y estar en el rango Android.")
    need(profile in ("demo", "production"), "Perfil inválido.")


def positive_id(value):
    need(re.fullmatch(r"[1-9][0-9]{0,18}", value), "ID inválido.")


def verify_run(run, artifact, control_sha, run_id, artifact_id, sha, version, code, profile, mode="live"):
    positive_id(run_id)
    positive_id(artifact_id)
    need(run.get("id") == int(run_id) and run.get("status") == "completed" and
         run.get("conclusion") == "success" and run.get("run_attempt") == 1 and
         run.get("event") == "workflow_dispatch" and run.get("head_branch") == BRANCH and
         run.get("head_sha") == control_sha and run.get("path") == BUILD,
         "Ejecución ajena, fallida, repetida o de otra revisión de control.")
    repository = run.get("repository") or {}
    head_repository = run.get("head_repository") or {}
    need(repository.get("full_name") == REPO and head_repository.get("full_name") == REPO and
         type(repository.get("id")) is int and head_repository.get("id") == repository.get("id"),
         "La ejecución no pertenece al repositorio autorizado.")
    title = re.fullmatch(r"Expo (codex/dashfort-mobile-[a-z0-9-]+) ([0-9a-f]{40}) ([0-9.]+) ([0-9]+) (demo|production) (lab|live)",
                         run.get("display_title", ""))
    need(title and title.groups()[1:] == (sha, version, code, profile, mode), "La solicitud difiere de la ejecución.")
    valid_release(*title.groups())
    origin = artifact.get("workflow_run") or {}
    archive_digest = artifact.get("digest", "")
    need(artifact.get("id") == int(artifact_id) and artifact.get("name") == f"dashfort-{mode}-unsigned-{run_id}" and
         artifact.get("expired") is False and origin.get("id") == int(run_id) and
         origin.get("head_branch") == BRANCH and origin.get("head_sha") == control_sha and
         origin.get("repository_id") == repository["id"] and origin.get("head_repository_id") == repository["id"] and
         type(artifact.get("size_in_bytes")) is int and 0 < artifact["size_in_bytes"] <= MAX_APK and
         isinstance(archive_digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", archive_digest),
         "El artefacto no corresponde a la ejecución o no tiene digest válido.")
    return archive_digest.removeprefix("sha256:")


def verify_approval(reviews, initiator, mode="live"):
    positive_id(initiator)
    need(int(initiator) != OWNER_ID, "El propietario no puede solicitar y aprobar la misma firma.")
    need(isinstance(reviews, list), "Historial de revisión inválido.")
    need(mode in ("lab", "live"), "Modo inválido.")
    environment = LAB_ENVIRONMENT if mode == "lab" else SIGNING_ENVIRONMENT
    for review in reviews:
        environments = review.get("environments") or []
        if not any(item.get("name") == environment for item in environments):
            continue
        need(review.get("state") != "rejected", "Hay una revisión negativa de la firma.")
    need(any(review.get("state") == "approved" and (review.get("user") or {}).get("id") == OWNER_ID
             and any(item.get("name") == environment for item in (review.get("environments") or []))
             for review in reviews), "No se encontró aprobación explícita del propietario.")


def unpack(archive, expected, destination):
    need(0 < archive.stat().st_size <= MAX_APK and digest(archive) == expected,
         "El digest del ZIP difiere del registrado por GitHub.")
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        need(len(entries) == 1 and entries[0].filename == "unsigned.apk" and
             0 < entries[0].file_size <= MAX_APK and
             not stat.S_ISLNK(entries[0].external_attr >> 16), "Contenido inesperado del ZIP de Actions.")
        with z.open(entries[0]) as source, destination.open("xb") as output:
            shutil.copyfileobj(source, output)
    need(destination.stat().st_size == entries[0].file_size, "APK truncada.")


def tool(name, *args):
    try:
        result = subprocess.run([str(name), *map(str, args)], capture_output=True, text=True, timeout=90)
    except subprocess.SubprocessError:
        raise ValueError("Tiempo agotado en la herramienta Android.") from None
    need(result.returncode == 0, "La herramienta Android rechazó el archivo.")
    return result.stdout


def verify_apk(path, expected, version, code, aapt, signed):
    need(0 < path.stat().st_size <= MAX_APK and digest(path) == expected, "SHA-256 de la APK incorrecto.")
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        need(len(names) == len(set(names)) and "AndroidManifest.xml" in names and
             sum(entry.file_size for entry in z.infolist()) <= 500 * 1024 * 1024,
             "Estructura de APK inválida.")
        for entry in z.infolist():
            name = entry.filename
            parts = PurePosixPath(name).parts
            need(bool(parts) and not name.startswith("/") and "\\" not in name and ".." not in parts and
                 not stat.S_ISLNK(entry.external_attr >> 16), "Nombre inseguro en APK.")
            lower = name.lower()
            need(not lower.endswith((".keystore", ".jks", ".p12", ".pfx", ".pem", ".pk8")) and
                 "service-account" not in lower and "service_account" not in lower,
                 "La APK incluye un archivo de credenciales.")
            if not signed:
                need(not (lower.startswith("meta-inf/") and lower.endswith((".rsa", ".dsa", ".ec", ".sf"))),
                     "La APK de entrada ya contiene una firma JAR.")
        if not signed:
            # The footer of any APK Signing Block precedes the central directory.
            with path.open("rb") as raw:
                need(z.start_dir >= 16, "Directorio ZIP inválido.")
                raw.seek(z.start_dir - 16)
                need(raw.read(16) != b"APK Sig Block 42", "La APK de entrada ya tiene bloque de firma.")
        need(z.testzip() is None, "CRC inválido.")
    badging = tool(aapt, "dump", "badging", path)
    package = re.search(r"(?m)^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    need(package and package.groups() == (PACKAGE, code, version), "Paquete, versionCode o versión incorrectos.")
    need(re.search(r"(?m)^native-code:\s*'arm64-v8a'\s*$", badging), "Se requiere exclusivamente ARM64.")


def same_payload(unsigned, signed):
    # APK v2/v3 adds a signing block outside the ZIP entries. APK resources
    # must remain exactly as approved across alignment and signing.
    with zipfile.ZipFile(unsigned) as before, zipfile.ZipFile(signed) as after:
        need(before.namelist() == after.namelist(), "Cambió la lista de miembros de la APK.")
        for name in before.namelist():
            with before.open(name) as original, after.open(name) as result:
                need(hashlib.file_digest(original, "sha256").digest() ==
                     hashlib.file_digest(result, "sha256").digest(), "Cambió el contenido firmado.")


def verify_certificate(apksigner, apk, fingerprint):
    res = tool(apksigner, "verify", "--verbose", "--print-certs", apk)
    certs = re.findall(r"(?im)^(?:V[23](?:\.\d)? )?Signer(?: #\d+)?: certificate SHA-256 digest: ([a-f0-9]{64})\s*$", res)
    need(certs and set(c.lower() for c in certs) == {fingerprint} and
         re.search(r"(?m)^Number of signers: 1\s*$", res) and
         all(re.search(rf"(?m)^Verified using {scheme} scheme .*: true\s*$", res) for scheme in ("v2", "v3")),
         "Certificado o esquemas de firma incorrectos.")


def main():
    p = argparse.ArgumentParser()
    cmd = p.add_subparsers(dest="cmd", required=True)
    for name, args in {
        "release": ("branch", "sha", "version", "code", "profile", "mode"),
        "run": ("run_json", "artifact_json", "control", "run_id", "artifact_id", "sha", "version", "code", "profile", "mode"),
        "approval": ("reviews_json", "initiator", "mode"),
        "unpack": ("archive", "digest", "destination"),
        "apk": ("path", "digest", "version", "code", "aapt"),
        "cert": ("apksigner", "apk", "fingerprint"),
        "payload": ("unsigned", "signed"),
    }.items():
        sub = cmd.add_parser(name)
        for arg in args:
            sub.add_argument(arg)
        if name == "apk":
            sub.add_argument("--signed", action="store_true")
    a = p.parse_args()
    if a.cmd == "release":
        valid_release(a.branch, a.sha, a.version, a.code, a.profile, a.mode)
    elif a.cmd == "run":
        print(verify_run(json.loads(Path(a.run_json).read_text()), json.loads(Path(a.artifact_json).read_text()),
                         a.control, a.run_id, a.artifact_id, a.sha, a.version, a.code, a.profile, a.mode))
    elif a.cmd == "approval":
        verify_approval(json.loads(Path(a.reviews_json).read_text()), a.initiator, a.mode)
    elif a.cmd == "unpack":
        unpack(Path(a.archive), a.digest, Path(a.destination))
    elif a.cmd == "apk":
        verify_apk(Path(a.path), a.digest, a.version, a.code, a.aapt, a.signed)
    elif a.cmd == "payload":
        same_payload(Path(a.unsigned), Path(a.signed))
    else:
        verify_certificate(a.apksigner, a.apk, a.fingerprint)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError, zipfile.BadZipFile) as error:
        print(str(error) if type(error) is ValueError else "Entrada o herramienta no disponible.", file=sys.stderr)
        sys.exit(1)

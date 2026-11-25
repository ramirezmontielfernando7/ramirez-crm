"""Local E2E. A real APK fixture and throwaway Android/GPG keys, no account or network."""
import base64
import copy
import hashlib
import io
import os
import secrets
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

import verify


def run(*args, env=None):
    return subprocess.run(list(map(str, args)), env=env, capture_output=True, text=True, check=True).stdout


class Provenance(unittest.TestCase):
    def setUp(self):
        self.commit = "a" * 40
        self.source = "b" * 40
        self.run_data = dict(id=101, status="completed", conclusion="success", run_attempt=1,
                             event="workflow_dispatch", head_branch=verify.BRANCH, head_sha=self.commit,
                             path=verify.BUILD, display_title=f"Expo codex/dashfort-mobile-lab {self.source} 0.2.3 14 demo",
                             repository={"full_name": verify.REPO, "id": 1},
                             head_repository={"full_name": verify.REPO, "id": 1})
        self.artifact = dict(id=201, name="dashfort-unsigned-101", size_in_bytes=300, expired=False,
                             digest="sha256:" + "c" * 64, workflow_run=dict(id=101, head_branch=verify.BRANCH,
                             head_sha=self.commit, repository_id=1, head_repository_id=1))

    def check(self, run_data, artifact, code="14"):
        return verify.verify_run(run_data, artifact, self.commit, "101", "201", self.source, "0.2.3", code, "demo")

    def test_provenance(self):
        self.assertEqual(self.check(self.run_data, self.artifact), "c" * 64)
        for field, value in (("head_sha", "d" * 40), ("run_attempt", 2), ("head_branch", "main"),
                             ("path", ".github/workflows/android.yml"), ("event", "push"),
                             ("conclusion", "failure"), ("head_repository", {"full_name": "fork/fork", "id": 2})):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check(dict(self.run_data, **{field: value}), self.artifact)
        for field, value in (("id", 202), ("expired", True), ("digest", None), ("name", "different")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check(self.run_data, dict(self.artifact, **{field: value}))
        wrong_parent = copy.deepcopy(self.artifact)
        wrong_parent["workflow_run"]["id"] = 102
        with self.assertRaises(ValueError):
            self.check(self.run_data, wrong_parent)
        with self.assertRaises(ValueError):
            self.check(self.run_data, self.artifact, code="15")

    def test_explicit_owner_approval(self):
        approval = {"state": "approved", "user": {"id": verify.OWNER_ID},
                    "environments": [{"name": verify.SIGNING_ENVIRONMENT}]}
        verify.verify_approval([approval], "102")
        for reviews in ([], [dict(approval, state="rejected")],
                        [dict(approval, user={"id": 103})],
                        [dict(approval, environments=[{"name": "other"}])],
                        [approval, dict(approval, state="rejected")]):
            with self.assertRaises(ValueError):
                verify.verify_approval(reviews, "102")
        with self.assertRaises(ValueError):
            verify.verify_approval([approval], str(verify.OWNER_ID))

    def test_release_inputs(self):
        verify.valid_release("codex/dashfort-mobile-lab", self.source, "0.2.3", "14", "demo")
        for branch, sha, version, code, profile in [
            ("main", self.source, "0.2.3", "14", "demo"),
            ("codex/dashfort-mobile-lab", "bad", "0.2.3", "14", "demo"),
            ("codex/dashfort-mobile-lab", self.source, "0.2\n3", "14", "demo"),
            ("codex/dashfort-mobile-lab", self.source, "0.2.3", "13", "demo"),
            ("codex/dashfort-mobile-lab", self.source, "0.2.3", "14", "staging"),
        ]:
            with self.assertRaises(ValueError):
                verify.valid_release(branch, sha, version, code, profile)


class Laboratory(unittest.TestCase):
    def test_end_to_end(self):
        tools = Path(os.environ["LAB_ANDROID_TOOLS"]).resolve()
        android = Path(os.environ["LAB_ANDROID_JAR"]).resolve()
        scripts = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(prefix="dashfort-lab-") as folder:
            root = Path(folder)
            manifest = root / "AndroidManifest.xml"
            manifest.write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android"
                package="com.demfort.dashfort.dev" android:versionCode="14" android:versionName="0.2.3">
                <uses-sdk android:minSdkVersion="24"/><application android:hasCode="false"/>
                </manifest>''')
            apk = root / "unsigned.apk"
            run(tools / "aapt2", "link", "-I", android, "--manifest", manifest, "-o", apk)
            with zipfile.ZipFile(apk, "a") as archive:
                archive.writestr("lib/arm64-v8a/libfixture.so", b"lab-only bytes")
            package = root / "artifact.zip"
            with zipfile.ZipFile(package, "w") as archive:
                archive.write(apk, "unsigned.apk")
            extracted = root / "verified.apk"
            verify.unpack(package, verify.digest(package), extracted)
            sha = verify.digest(apk)
            aapt = tools / "aapt"
            verify.verify_apk(extracted, sha, "0.2.3", "14", aapt, False)
            with self.assertRaises(ValueError):
                verify.unpack(package, "0" * 64, root / "tampered.apk")
            with self.assertRaises(ValueError):
                verify.verify_apk(extracted, "0" * 64, "0.2.3", "14", aapt, False)
            with self.assertRaises(ValueError):
                verify.verify_apk(extracted, sha, "0.2.3", "15", aapt, False)
            bad_manifest = root / "WrongManifest.xml"
            bad_manifest.write_text(manifest.read_text().replace(verify.PACKAGE, "com.demfort.dashfort"))
            wrong_app = root / "wrong.apk"
            run(tools / "aapt2", "link", "-I", android, "--manifest", bad_manifest, "-o", wrong_app)
            with zipfile.ZipFile(wrong_app, "a") as archive:
                archive.writestr("lib/arm64-v8a/libfixture.so", b"lab-only bytes")
            with self.assertRaises(ValueError):
                verify.verify_apk(wrong_app, verify.digest(wrong_app), "0.2.3", "14", aapt, False)
            with zipfile.ZipFile(wrong_app, "a") as archive:
                archive.writestr("assets/fixture.p12", b"mock only")
            with self.assertRaisesRegex(ValueError, "credenciales"):
                verify.verify_apk(wrong_app, verify.digest(wrong_app), "0.2.3", "14", aapt, False)
            with zipfile.ZipFile(package, "a") as archive:
                archive.writestr("../unexpected", b"ignored")
            with self.assertRaises(ValueError):
                verify.unpack(package, verify.digest(package), root / "unsafe.apk")

            keystore = root / "disposable.p12"
            env = dict(os.environ, LAB_PASSWORD=secrets.token_hex(24))
            run("keytool", "-genkeypair", "-storetype", "PKCS12", "-keystore", keystore,
                "-alias", "lab", "-keyalg", "RSA", "-keysize", "2048", "-validity", "1",
                "-dname", "CN=Dashfort Disposable Lab", "-storepass:env", "LAB_PASSWORD", env=env)
            der = subprocess.check_output(["keytool", "-exportcert", "-alias", "lab", "-keystore",
                                           str(keystore), "-storepass:env", "LAB_PASSWORD"], env=env)
            fingerprint = hashlib.sha256(der).hexdigest()
            self.assertNotEqual(fingerprint, verify.FINGERPRINT)
            env.update(MOBILE_KEYSTORE_B64=base64.b64encode(keystore.read_bytes()).decode(),
                       MOBILE_STORE_PASSWORD=env["LAB_PASSWORD"], MOBILE_KEY_PASSWORD=env["LAB_PASSWORD"],
                       MOBILE_KEY_ALIAS="lab")
            output = root / "signed"
            run(scripts / "sign.sh", extracted, sha, "0.2.3", "14", fingerprint, output, tools, env=env)
            signed = next(output.glob("*.apk"))
            self.assertEqual(Path(f"{signed}.sha256").read_text().split()[0], verify.digest(signed))
            with self.assertRaises(ValueError):
                verify.verify_certificate(tools / "apksigner", signed, verify.FINGERPRINT)
            with self.assertRaises(ValueError):
                verify.verify_apk(signed, verify.digest(signed), "0.2.3", "14", aapt, False)
            with self.assertRaises(subprocess.CalledProcessError):
                run(scripts / "sign.sh", extracted, sha, "0.2.3", "14", verify.FINGERPRINT,
                    root / "refused", tools, env=env)
            self.assertFalse((root / "refused").exists())

            home = root / "gnupg"
            home.mkdir(mode=0o700)
            gpg_env = dict(os.environ, GNUPGHOME=str(home))
            run("gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-generate-key",
                "Disposable Lab <lab@example.invalid>", "rsa2048", "encr", "1d", env=gpg_env)
            keys = run("gpg", "--batch", "--with-colons", "--list-keys", env=gpg_env)
            recipient = next(line.split(":")[9] for line in keys.splitlines() if line.startswith("fpr:"))
            backup = root / "test-backup.gpg"
            run(scripts / "backup.sh", keystore, recipient, backup, env=gpg_env)
            raw = subprocess.check_output(["gpg", "--batch", "--decrypt", str(backup)],
                                          env=gpg_env, stderr=subprocess.DEVNULL)
            with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
                self.assertEqual(archive.getnames(), ["dashfort-mobile.keystore"])
                self.assertEqual(archive.extractfile("dashfort-mobile.keystore").read(), keystore.read_bytes())
            with self.assertRaises(subprocess.CalledProcessError):
                run(scripts / "backup.sh", keystore, recipient, backup, env=gpg_env)


if __name__ == "__main__":
    unittest.main(verbosity=2)

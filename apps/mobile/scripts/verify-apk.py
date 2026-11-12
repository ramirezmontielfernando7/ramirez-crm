#!/usr/bin/env python3
"""Comprueba un APK ARM64 de Dashfort sin instalarlo, firmarlo ni modificarlo."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("apk", type=Path)
parser.add_argument("--sdk", type=Path, default=os.environ.get("ANDROID_HOME"))
parser.add_argument("--certificate", help="SHA-256 público esperado del firmante")
args = parser.parse_args()
if not args.sdk:
    parser.error("Indica --sdk o ANDROID_HOME")
build_tools = args.sdk / "build-tools" / "37.0.0"
def command(*parts):
    return subprocess.check_output([str(p) for p in parts], text=True, stderr=subprocess.STDOUT)
badging = command(build_tools / "aapt", "dump", "badging", args.apk)
package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
assert package and package[1] == "com.demfort.dashfort.dev", "Identificador Android inesperado"
assert "native-code: 'arm64-v8a'" in badging, "ABI inesperada"
min_sdk = int(re.search(r"sdkVersion:'(\d+)'", badging)[1])
target = int(re.search(r"targetSdkVersion:'(\d+)'", badging)[1])
assert min_sdk <= 36 and target == 36, "Revisar compatibilidad con Android 16"
manifest = command(build_tools / "aapt", "dump", "xmltree", args.apk, "AndroidManifest.xml")
assert not re.search(r"android:(?:debuggable|testOnly).*0xffffffff", manifest), "APK de depuración/prueba"
signing = command(build_tools / "apksigner", "verify", "--verbose", "--print-certs", args.apk)
assert "Verified using v2 scheme (APK Signature Scheme v2): true" in signing, "Falta firma APK v2"
certificate = re.search(r"certificate SHA-256 digest: (\w+)", signing)[1].lower()
if args.certificate:
    assert certificate == args.certificate.replace(":", "").lower(), "Firma distinta: no actualiza la app instalada"
command(build_tools / "zipalign", "-c", "-P", "16", "4", args.apk)
libs = []
with zipfile.ZipFile(args.apk) as apk:
    assert apk.testzip() is None, "CRC inválido"
    names = apk.namelist()
    assert len(names) == len(set(names)), "Entradas duplicadas en APK"
    assert not any(Path(n).suffix in (".keystore", ".jks", ".p12", ".pfx") for n in names), "Material privado empaquetado"
    abis = sorted({n.split('/')[1] for n in names if n.startswith('lib/') and n.endswith('.so')})
    assert abis == ["arm64-v8a"], "El APK no es exclusivamente ARM64"
    for name in names:
        if not name.endswith(".so"):
            continue
        with apk.open(name) as lib:
            header = lib.read(64)
            assert header[:6] == b"\x7fELF\x02\x01", f"ELF 64-bit inesperado: {name}"
            assert struct.unpack_from("<H", header, 18)[0] == 183, f"No es AArch64: {name}"
            offset = struct.unpack_from("<Q", header, 32)[0]
            size, count = struct.unpack_from("<HH", header, 54)
            lib.seek(offset)
            programs = lib.read(size * count)
            alignments = [struct.unpack_from("<Q", programs, i * size + 48)[0]
                          for i in range(count) if struct.unpack_from("<I", programs, i * size)[0] == 1]
            assert alignments and all(v >= 16384 for v in alignments), f"ELF sin alineación 16 KB: {name}"
            libs.append({"library": name, "load_segment_alignment": alignments})
    bundle = apk.read("assets/index.android.bundle")
    assert bundle[:8] == bytes.fromhex("c61fbc03c103191f"), "Falta bytecode Hermes"
    fonts = [n for n in names if n.lower().endswith((".ttf", ".otf"))]
    assert fonts, "Faltan las fuentes locales"
result = {
    "apk": str(args.apk), "bytes": args.apk.stat().st_size,
    "sha256": hashlib.file_digest(args.apk.open("rb"), "sha256").hexdigest(),
    "package": package[1], "versionCode": int(package[2]), "version": package[3],
    "minSdk": min_sdk, "targetSdk": target, "abis": abis,
    "signature_v2_verified": True, "certificate_sha256": certificate,
    "zipalign_16k_verified": True, "elf_16k_verified": True,
    "native_libraries": libs, "hermes_bundle_bytes": len(bundle), "packaged_fonts": len(fonts),
    "installation_test": "No ejecutado por este verificador estático",
}
print(json.dumps(result, ensure_ascii=False, indent=2))

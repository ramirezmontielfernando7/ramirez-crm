"""Package this visual-only delivery; no services, Git mutations or network."""
import hashlib
import json
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

LAB = Path(__file__).resolve().parent
MOBILE = LAB.parents[1]
REPO = MOBILE.parents[1]
BASE = 'f3f467abb7640ec13ffba590bc5dad91bc5cfd77'
BACKEND = Path('/workspace/work/dashfort-auth-offline')
BACKEND_SHA = '562a8b386b7f0d0df9292406167357aa988fd4d0'
APK_SHA = '36f3a4781220eff96ef9938e1d07adbf9ceac7797254ad3cc94f2b7d75b18f7a'


def git(*args, cwd=REPO):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()


assert git('branch', '--show-current') == 'codex/dashfort-mobile-visual-lab-20261119'
changed = git('diff', '--name-only', BASE).splitlines()
assert all(p.startswith('apps/mobile/labs/visual-refinement/') for p in changed), changed
assert git('rev-parse', 'HEAD', cwd=BACKEND) == BACKEND_SHA
assert not git('status', '--porcelain', cwd=BACKEND)
apk = MOBILE / 'artifacts/tm5b/Dashfort-Mobile-TM5B-0.1.2-ARM64.apk'
assert hashlib.sha256(apk.read_bytes()).hexdigest() == APK_SHA

out = LAB / 'output'
files = {
    'index.html': (out / 'index.html').read_bytes(),
    'LEEME.md': (LAB / 'README.md').read_bytes(),
    'evidencias/metrics.json': (out / 'metrics.json').read_bytes(),
    'evidencias/verification.json': (LAB / 'evidence/verification.json').read_bytes(),
}
dimensions = {}
for png in sorted(out.glob('*.png')):
    data = png.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', png.name
    w, h = struct.unpack('>II', data[16:24])
    if png.name.startswith('comparacion-'):
        folder = 'comparaciones'
    else:
        folder = 'capturas'
        expected = png.stem.split('-')[-1]
        assert f'{w}x{h}' == expected, png.name
    name = f'{folder}/{png.name}'
    files[name] = data
    dimensions[name] = [w, h]
assert len([p for p in files if p.startswith('capturas/')]) == 32
assert len([p for p in files if p.startswith('comparaciones/')]) == 12
for name in ['profiles.ts', 'ui.tsx', 'entry.tsx', 'browser.d.ts', 'render.mjs', 'present.mjs', 'package.py']:
    files['codigo-laboratorio/' + name] = (LAB / name).read_bytes()
manifest = {
    'branch': git('branch', '--show-current'),
    'sourceCommit': git('rev-parse', 'HEAD'),
    'baselineCommit': BASE,
    'backendCommitUnchanged': BACKEND_SHA,
    'previousApkSha256Unchanged': APK_SHA,
    'runtimeChanged': False,
    'nativeValidation': False,
    'screenshots': 32,
    'comparisonBoards': 12,
    'imageDimensions': dimensions,
}
files['manifest.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
files['SHA256SUMS.txt'] = ''.join(
    f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(files.items())
).encode()
destination = Path(sys.argv[1]) if len(sys.argv) > 1 else out / 'Dashfort-Laboratorio-Visual.zip'
destination.parent.mkdir(parents=True, exist_ok=True)
if destination.exists():
    raise SystemExit('The delivery already exists; choose a new filename to preserve it.')
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, data in files.items():
        archive.writestr(name, data)
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
print(json.dumps({'path': str(destination), 'bytes': destination.stat().st_size,
                  'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                  'files': len(files), 'sourceCommit': manifest['sourceCommit']}, indent=2))

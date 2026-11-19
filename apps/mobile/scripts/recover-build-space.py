"""Task-specific cleanup: default read-only; --apply removes only listed derived caches.

Never deletes SDK/JDK, Maven originals, node_modules, build outputs, worktrees or backups.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
workspace = Path('/workspace')
repo = workspace / 'work/ramirez-crm'
backend = workspace / 'work/dashfort-auth-offline'
targets = {
    'gradleDerivedTransforms': workspace / 'work/apk-tm3/gradle-cache/caches/9.4.1/transforms',
    'metroDerivedCache': Path('/tmp/metro-cache'),
    'npmDownloadedTarballCache': Path('/tmp/dashfort-npm/_cacache'),
    'oldExpoBundlerTemp': Path('/tmp/expo-bundler-0.7011155347268281-1794419179555'),
}
def git(directory, *parts):
    return subprocess.check_output(['git', *parts], cwd=directory, text=True).strip()
def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()
def disk():
    d = shutil.disk_usage(workspace)
    return {'totalBytes': d.total, 'usedBytes': d.used, 'availableBytes': d.free}
def git_state():
    return {str(p): {'head': git(p, 'rev-parse', 'HEAD'), 'branches': git(p, 'show-ref', '--heads'), 'status': git(p, 'status', '--porcelain')} for p in [repo, backend]}

# Safety: no live Gradle or Metro process may use these caches.
for entry in Path('/proc').iterdir():
    if not entry.name.isdigit(): continue
    try:
        comm = (entry / 'comm').read_text().strip()
        cmd = (entry / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
    except (FileNotFoundError, PermissionError, ProcessLookupError): continue
    if comm in ('java', 'node', 'npm') and any(x in cmd for x in ['GradleDaemon', 'org.gradle.launcher', 'expo start', 'metro serve', 'npm install', 'npm ci']):
        raise SystemExit(f'An active build/install process uses these caches: PID {entry.name}; no cleanup performed.')

protected_names = subprocess.check_output(['rg', '--files', '--hidden', '--no-ignore', '-g', '*.apk', '-g', '*.bundle', '-g', '*.keystore', '-g', '*.jks', '-g', '*.p12', str(workspace / 'work')], text=True).splitlines()
protected = {name: digest(Path(name)) for name in protected_names}
before = disk()
before_git = git_state()
catalog = []
for category, target in targets.items():
    if not target.exists():
        catalog.append({'category': category, 'path': str(target), 'present': False})
        continue
    assert target.is_dir() and not target.is_symlink() and target.resolve() == target
    count, allocated = 0, 0
    seen = set()
    for directory, folders, files in os.walk(target, followlinks=False):
        assert '.git' not in folders, 'A Git repository is not a cache.'
        for name in files:
            p = Path(directory) / name
            assert p.suffix.lower() not in {'.apk', '.keystore', '.jks', '.p12', '.pfx', '.bundle'}, f'Protected artifact found: {p}'
            st = p.lstat()
            inode = (st.st_dev, st.st_ino)
            if inode not in seen:
                allocated += st.st_blocks * 512
                seen.add(inode)
            count += 1
    item = {'category': category, 'path': str(target), 'present': True, 'files': count, 'allocatedFileBytesBefore': allocated, 'deleted': False}
    if args.apply:
        shutil.rmtree(target)
        item['deleted'] = True
    catalog.append(item)
after = disk()
assert git_state() == before_git, 'Worktree state changed during cleanup.'
for name, sha in protected.items():
    assert Path(name).is_file() and digest(Path(name)) == sha, f'Protected artifact changed: {name}'
report = {'applied': args.apply, 'before': before, 'after': after, 'recoveredAvailableBytes': after['availableBytes'] - before['availableBytes'], 'targets': catalog, 'protectedArtifactCount': len(protected), 'protectedArtifactsUnchanged': protected, 'worktreeHeadsUnchanged': {p: s['head'] for p, s in before_git.items()}, 'sdkNdkJdkMavenOriginalsNodeModulesPreserved': True, 'oldBuildOutputsPreserved': True, 'gradleStarted': False, 'recommendedFreeBytesForIsolatedBuild': 15 * 1024**3, 'safeToAttemptNewBuild': after['availableBytes'] >= 15 * 1024**3}
args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ['protectedArtifactsUnchanged']}, indent=2))

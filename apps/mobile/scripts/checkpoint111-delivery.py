"""Preserve a new local delivery without replacing or uploading anything.
From apps/mobile: python3 scripts/checkpoint111-delivery.py NEW.zip CURRENT.bundle PRIOR107.zip
Requires a clean commit. The cumulative bundle requires the preserved Offline f3 base.
"""
from pathlib import Path
import csv,hashlib,json,subprocess,sys,zipfile
root=Path.cwd();target=Path(sys.argv[1]);bundle=Path(sys.argv[2]).resolve();previous=Path(sys.argv[3]).resolve()
assert not target.exists(),'Existing deliveries are protected.'
assert bundle.is_file()and previous.is_file()
assert not subprocess.check_output(['git','status','--porcelain'],text=True),'Commit first.'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();branch=subprocess.check_output(['git','branch','--show-current'],text=True).strip()
assert branch=='codex/dashfort-mobile-b-continuation-20261119'
subprocess.run(['git','bundle','verify',str(bundle)],check=True,capture_output=True)
assert any(s.startswith(head+' ')for s in subprocess.check_output(['git','bundle','list-heads',str(bundle)],text=True).splitlines())
with(root/'docs/cobertura.csv').open()as f:rows=list(csv.DictReader(f))
implemented=[r['ID']for r in rows if r['Estado'].startswith('Implementada')];pending=[r['ID']for r in rows if not r['Estado'].startswith('Implementada')]
assert len(rows)==158 and len(implemented)==111
files={}
with zipfile.ZipFile(previous)as z:
 assert z.testzip()is None
 for name in z.namelist():
  assert not Path(name).is_absolute()and '..'not in Path(name).parts
  if not name.startswith('respaldo/')and name not in ['manifest.json','SHA256SUMS.txt','index.html','LEEME.md']:files[name]=z.read(name)
for label,folder in [('catalogos','catalog'),('agenda-conectores','calendar-settings'),('regresion111','regression-111')]:
 base=root/'docs/refinement-b/evidence'/folder
 for p in base.rglob('*'):
  if p.is_file():files[label+'/'+str(p.relative_to(base))]=p.read_bytes()
for p in(root/'docs/refinement-b').glob('LOTE-*.md'):files['documentos/'+p.name]=p.read_bytes()
for name in ['inventory-111.json','protected-111.json','validation-111.json']:files['documentos/'+name]=(root/'docs/refinement-b/evidence'/name).read_bytes()
files['documentos/CHECKPOINT-111.md']=(root/'docs/refinement-b/CHECKPOINT-111.md').read_bytes()
files['inventario-158.csv']=(root/'docs/cobertura.csv').read_bytes();files['respaldo/'+bundle.name]=bundle.read_bytes()
manifest={'branch':branch,'commit':head,'from':'fef438776b1d25166abb61464c7f33b9aaa82f86','implementedIds':111,'pendingIds':pending,'logicTests':448,'newActualCaptures':32,'newOfficialReferences':8,'apkBuilt':False,'nativeTestsPerformed':False,'backendCommit':'562a8b386b7f0d0df9292406167357aa988fd4d0','bundlePrerequisite':'f3f467abb7640ec13ffba590bc5dad91bc5cfd77','bundleSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'privateSigningFilesIncluded':False,'pushPerformed':False,'nextIds':['SET-03','SET-03A','SET-03B']}
files['manifest.json']=json.dumps(manifest,indent=2).encode()
files['LEEME.md']=f'''# Dashfort Mobile · 111/158
Rama: {branch}\nCommit: {head}\n448 pruebas de lógica; 47 IDs pendientes. QA RN Web offline, no Android/iOS.

Abra index.html sin conexión. 32 capturas nuevas reales y 8 referencias de Catálogos y Agenda/conectores. Los informes previos conservados corresponden a sus propios checkpoints; el estado actual está en documentos/CHECKPOINT-111.md, manifest.json e inventario-158.csv.

El bundle acumulativo requiere la base Offline f3f467abb7640ec13ffba590bc5dad91bc5cfd77. Conserve aquel paquete/repositorio. En una copia que contenga la base: git bundle verify RUTA.bundle. Recupere a una rama local NUEVA, nunca reset/main ni un árbol con cambios. No es un repositorio completo independiente. Este ZIP incluye un único bundle actual; los respaldos físicos anteriores no se eliminan.

No contiene APK, claves privadas o backend preparado. La APK 0.1.2 y firma están en sus respaldos anteriores, sin cambios. No existe una APK nueva por disco insuficiente. No se subió nada a Drive/GitHub, no hay servicios o integración real. Próximo SET-03/03A/03B: personas, roles e invitaciones completamente ficticios y compartidos, antes de Equipo.
'''.encode()
links=[('Etiquetas y motivos compartidos','catalogos'),('Agenda y conectores ficticios','agenda-conectores'),('Uso y plan','uso-plan'),('Avisos','avisos'),('Respuestas rápidas','respuestas-rapidas'),('Apertura','apertura'),('Agentes','agentes'),('Versiones','versiones'),('Asignaciones','asignaciones'),('Evaluaciones','evaluaciones'),('Asistente','asistente')]
files['index.html']=('''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashfort · 111/158</title><style>body{max-width:950px;margin:auto;padding:24px;font:16px/1.6 system-ui;background:#f5f5f7;color:#1d1d1f}a{color:#0b6a6d}li{margin:10px 0}</style><h1>Dashfort Mobile · 111/158 IDs</h1><p>448 pruebas de lógica aprobadas, 47 IDs pendientes. B original conservada. 32 capturas RN nuevas y 8 referencias; solo simulaciones, sin QA nativa ni una APK nueva.</p><ul>'''+''.join(f'<li><a href="{folder}/comparacion.html">{label}</a></li>'for label,folder in links)+'''<li><a href="documentos/CHECKPOINT-111.md">Informe, límites y reanudación exacta</a></li><li><a href="inventario-158.csv">Inventario completo</a> · <a href="manifest.json">SHA y respaldo</a></li><li><a href="LEEME.md">Recuperación</a> · <a href="b/index.html">B original</a></li></ul><p>Sin backend, bases de datos, IA, WhatsApp, cuentas, proveedores, pagos o conexiones reales. Sin push ni despliegues. APK y firma anteriores conservadas.</p></html>''').encode()
assert not any(Path(name).suffix.lower()in['.apk','.jks','.keystore','.p12','.pfx','.key','.pem']for name in files)
files['SHA256SUMS.txt']=''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n'for name,data in sorted(files.items())).encode()
target.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as z:
 for name,data in files.items():z.writestr(name,data)
with zipfile.ZipFile(target)as z:assert z.testzip()is None
print(json.dumps({'path':str(target),'commit':head,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':len(files)},indent=2))

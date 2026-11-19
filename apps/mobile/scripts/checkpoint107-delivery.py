"""New local delivery from a preserved prior ZIP + current cumulative bundle.
Run from apps/mobile: python3 scripts/checkpoint107-delivery.py NEW.zip CURRENT.bundle PRIOR97.zip
No upload, build, signing material, replacement or service startup.
"""
from pathlib import Path
import csv, hashlib, json, subprocess, sys, zipfile
root=Path.cwd();target=Path(sys.argv[1]);bundle=Path(sys.argv[2]).resolve();previous=Path(sys.argv[3]).resolve()
assert not target.exists(), 'Existing deliveries are protected.'
assert bundle.is_file() and previous.is_file()
assert not subprocess.check_output(['git','status','--porcelain'],text=True),'Commit first.'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
branch=subprocess.check_output(['git','branch','--show-current'],text=True).strip()
assert branch=='codex/dashfort-mobile-b-continuation-20261119'
subprocess.run(['git','bundle','verify',str(bundle)],check=True,capture_output=True)
assert any(s.startswith(head+' ')for s in subprocess.check_output(['git','bundle','list-heads',str(bundle)],text=True).splitlines())
with(root/'docs/cobertura.csv').open()as f:rows=list(csv.DictReader(f))
implemented=[r['ID']for r in rows if r['Estado'].startswith('Implementada')]
pending=[r['ID']for r in rows if not r['Estado'].startswith('Implementada')]
assert len(rows)==158 and len(implemented)==107
files={}
with zipfile.ZipFile(previous)as z:
 assert z.testzip() is None
 for name in z.namelist():
  assert not Path(name).is_absolute() and '..'not in Path(name).parts
  if not name.startswith('respaldo/')and name not in ['SHA256SUMS.txt','manifest.json','index.html','LEEME.md']:files[name]=z.read(name)
for label,folder in [('uso-plan','usage'),('avisos','notices'),('respuestas-rapidas','quick'),('apertura','opening'),('regresion107','regression-107')]:
 base=root/'docs/refinement-b/evidence'/folder
 for p in base.rglob('*'):
  if p.is_file():files[label+'/'+str(p.relative_to(base))]=p.read_bytes()
for p in(root/'docs/refinement-b').glob('LOTE-*.md'):files['documentos/'+p.name]=p.read_bytes()
files['documentos/CHECKPOINT-107.md']=(root/'docs/refinement-b/CHECKPOINT-107.md').read_bytes()
for name in ['inventory-107.json','protected-107.json','validation-107.json']:files['documentos/'+name]=(root/'docs/refinement-b/evidence'/name).read_bytes()
files['inventario-158.csv']=(root/'docs/cobertura.csv').read_bytes()
files['respaldo/'+bundle.name]=bundle.read_bytes()
manifest={'branch':branch,'commit':head,'from':'cec3612de3bed61682bb6906bb193155035a2cc5','implementedIds':107,'pendingIds':pending,'logicTests':407,'newActualCaptures':60,'newOfficialReferences':20,'apkBuilt':False,'nativeTestsPerformed':False,'backendCommit':'562a8b386b7f0d0df9292406167357aa988fd4d0','bundlePrerequisite':'f3f467abb7640ec13ffba590bc5dad91bc5cfd77','bundleSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'privateSigningFilesIncluded':False,'pushPerformed':False,'nextIds':['SET-05','SET-05A','SET-07']}
files['manifest.json']=json.dumps(manifest,indent=2).encode()
files['LEEME.md']=f'''# Dashfort Mobile · 107/158
Rama: {branch}\nCommit: {head}\n407 pruebas de lógica aprobadas. QA RN Web offline, no Android/iOS.

Abra index.html sin conexión. Las galerías nuevas contienen capturas RN reales y referencias oficiales en ambos temas y tamaños. Se conservan las galerías/documentación previas como evidencia histórica; las cifras de esos informes anteriores corresponden a su propio checkpoint. El estado actual está en manifest.json y documentos/CHECKPOINT-107.md.

El bundle acumulativo necesita la base Offline f3f467abb7640ec13ffba590bc5dad91bc5cfd77. Conserve aquel paquete/repositorio. En una copia que contenga esa base: git bundle verify RUTA.bundle. Recupere hacia una rama local NUEVA, nunca use reset/main ni sobrescriba un árbol con cambios. El bundle no es un repositorio completo independiente de su base. El ZIP no incluye backend preparado, APK o claves privadas; todos permanecen en sus respaldos anteriores sin cambios. Contiene un único bundle actual para ahorrar duplicación dentro de este paquete, sin borrar archivos previos.

La APK 0.1.2 sigue intacta. No existe una nueva APK B/0.1.3: falta almacenamiento seguro para Gradle. No se subió este ZIP a Drive/GitHub, no se arrancó ningún servicio ni se activó integración real. Próximo lote: SET-05/05A y SET-07, únicamente catálogos ficticios canónicos compartidos.
'''.encode()
links=[('Uso y plan, límites del asistente','uso-plan'),('Avisos y preferencias','avisos'),('Respuestas rápidas compartidas con Chat','respuestas-rapidas'),('Apertura aprobada','apertura'),('Versiones locales','versiones'),('Asignaciones','asignaciones'),('Evaluaciones','evaluaciones'),('Asistente','asistente'),('Agentes','agentes'),('Conocimiento','conocimiento')]
files['index.html']=('''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashfort · 107/158</title><style>body{max-width:950px;margin:auto;padding:24px;font:16px/1.6 system-ui;background:#f5f5f7;color:#1d1d1f}a{color:#0b6a6d}li{margin:10px 0}</style><h1>Dashfort Mobile · 107/158 IDs</h1><p>407 pruebas de lógica aprobadas. 51 IDs pendientes. Diseño B original conservado; solo simulaciones. 60 capturas nuevas reales y 20 referencias. QA web, no pruebas Android/iOS ni APK nueva.</p><ul>'''+''.join(f'<li><a href="{folder}/comparacion.html">{title}</a></li>'for title,folder in links)+'''<li><a href="b/index.html">Propuesta B original</a></li><li><a href="documentos/CHECKPOINT-107.md">Informe, limitaciones y reanudación exacta</a></li><li><a href="inventario-158.csv">Inventario completo de 158 IDs</a></li><li><a href="manifest.json">SHA, pruebas y respaldo</a> · <a href="LEEME.md">Recuperación</a></li></ul><p>No se inició backend, PostgreSQL, servicios, WhatsApp, IA o pagos reales. No push ni despliegues. La APK 0.1.2 y la firma permanecen en sus respaldos anteriores.</p></html>''').encode()
assert not any(Path(name).suffix.lower()in['.apk','.jks','.keystore','.p12','.pfx','.key','.pem']for name in files)
files['SHA256SUMS.txt']=''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n'for name,data in sorted(files.items())).encode()
target.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as z:
 for name,data in files.items():z.writestr(name,data)
with zipfile.ZipFile(target)as z:assert z.testzip()is None
print(json.dumps({'path':str(target),'commit':head,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':len(files)},indent=2))

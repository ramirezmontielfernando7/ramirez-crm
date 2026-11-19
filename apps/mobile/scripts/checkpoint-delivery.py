"""Build a NEW offline delivery from preserved evidence and an incremental Git bundle.
Never upload, modify the app, sign, compile, or overwrite an existing delivery.
Usage: python3 scripts/checkpoint-delivery.py NEW.zip CURRENT.bundle
"""
from pathlib import Path
import csv,hashlib,json,subprocess,sys,zipfile
root=Path.cwd();target=Path(sys.argv[1]);bundle=Path(sys.argv[2]).resolve()
assert not target.exists(),'Existing delivery is protected; choose a new filename.'
assert bundle.is_file() and bundle.suffix=='.bundle'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();branch=subprocess.check_output(['git','branch','--show-current'],text=True).strip()
assert not subprocess.check_output(['git','status','--porcelain'],text=True),'Commit and verify the checkpoint before packaging.'
subprocess.run(['git','bundle','verify',str(bundle)],check=True,capture_output=True)
refs=subprocess.check_output(['git','bundle','list-heads',str(bundle)],text=True).splitlines();assert any(line.startswith(head+' ') for line in refs)
files={}
# Earlier package is read only; preserve its original galleries and reports.
previous=Path('/workspace/entregables/Dashfort-Mobile-B-Agenda-cca411d.zip')
with zipfile.ZipFile(previous) as z:
 for name in z.namelist():files[name]=z.read(name)
for lot,folder in [('tareas-notas','work'),('resultados','results'),('conocimiento','knowledge')]:
 base=root/'docs/refinement-b/evidence'/folder
 for p in base.rglob('*'):
  if p.is_file():files[lot+'/'+str(p.relative_to(base))]=p.read_bytes()
for p in (root/'docs/refinement-b').glob('LOTE-*.md'):files['documentos/'+p.name]=p.read_bytes()
files['inventario-158.csv']=(root/'docs/cobertura.csv').read_bytes()
files['respaldo/'+bundle.name]=bundle.read_bytes()
with (root/'docs/cobertura.csv').open() as f:rows=list(csv.DictReader(f))
count=sum(r['Estado'].startswith('Implementada') for r in rows)
manifest={'branch':branch,'commit':head,'from':'cca411de501a21f26ab5ad7e2827bb164d68a133','implementedIds':count,'pendingIds':len(rows)-count,'totalIds':len(rows),'logicTests':281,'newActualCaptures':58,'newOfficialReferences':18,'sourceBundleIncluded':True,'bundlePrerequisiteOffline':'f3f467abb7640ec13ffba590bc5dad91bc5cfd77','bundleSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'backendUnchanged':'562a8b386b7f0d0df9292406167357aa988fd4d0','apkBuilt':False,'nativeTestsPerformed':False,'pushPerformed':False,'privateSigningFilesIncluded':False}
files['manifest.json']=json.dumps(manifest,indent=2).encode()
files['LEEME.md']=f'''# Dashfort Mobile · checkpoint {head[:7]}

Rama: {branch}. {count}/158 IDs, {158-count} pendientes. 281 pruebas de lógica; capturas RN Web offline, no Android/iOS.

Abra index.html sin conexión. Incluye las galerías anteriores B/Biblioteca/Agenda y los tres lotes nuevos. Las comparaciones nuevas esperan la hoja Modal realmente renderizada. Consulte los informes por lote para límites y siguiente trabajo.

## Recuperación del código

El bundle de respaldo es incremental: requiere el commit Offline f3f467abb7640ec13ffba590bc5dad91bc5cfd77 del paquete ya conservado. Mantenga ambos paquetes. No se elimina ningún respaldo anterior. Dentro de un repositorio que contenga esa base, ejecute git bundle verify sobre el bundle antes de usar git fetch del archivo hacia una rama nueva local. No haga checkout/reset de main ni de un árbol con trabajo pendiente. No se requiere GitHub ni un push para conservar este checkpoint.

No incluye APK ni clave de firma. La APK 0.1.2 y firma están en sus respaldos previos y permanecen intactas. No hay una APK nueva porque no existe espacio seguro para Gradle. No se utilizó ningún servicio externo.

Siguiente lote exacto: Agentes LAB-01/02/03/04/08/09/09A, seguido de versiones LAB-05/06/06C/07 y luego Asignación/Pruebas. Son futuras simulaciones, no autorización para activar agentes reales. Backend reservado 562a8b3 sin cambios/arranque. Sin push, PR, merge, producción, BD, WhatsApp o despliegues.
'''.encode()
files['index.html']='''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashfort · checkpoint 79</title><style>body{max-width:960px;margin:auto;padding:24px;font:16px/1.6 system-ui;background:#f5f5f7;color:#1d1d1f}a{color:#0b6a6d}li{margin:12px 0}</style><h1>Dashfort Mobile · 79/158 IDs</h1><p>281 pruebas de lógica aprobadas. Nueve IDs nuevos en tres lotes; 79 pendientes. Todas las galerías se abren sin red.</p><ul><li><a href="tareas-notas/comparacion.html">Tareas y Notas · CRM-30…33</a></li><li><a href="resultados/comparacion.html">Resultados · RES-01/02</a></li><li><a href="conocimiento/comparacion.html">Conocimiento · LAB-10…12</a></li><li><a href="b/index.html">B original, anterior e implementada</a></li><li><a href="biblioteca/index.html">Biblioteca anterior</a> · regresión nueva incluida en conocimiento/library-regression</li><li><a href="agenda/index.html">Agenda</a></li><li><a href="inventario-158.csv">Inventario de 158 IDs</a></li><li><a href="documentos/LOTE-05-CONOCIMIENTO.md">Resultados, limitaciones y siguiente lote exacto</a></li><li><a href="manifest.json">Commit y datos del respaldo</a> · <a href="LEEME.md">recuperación</a></li></ul><p>58 capturas nuevas de implementación y 18 referencias de las maquetas; ambos temas y tamaños. QA RN Web, sin pruebas nativas ni nueva APK. El bundle incremental conserva el código y requiere la base Offline anterior. No se hizo push ni se tocó producción.</p></html>'''.encode()
files.pop('SHA256SUMS.txt',None)
files['SHA256SUMS.txt']=''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name,data in sorted(files.items())).encode()
assert not any(Path(n).suffix.lower() in ['.apk','.keystore','.jks','.p12','.pfx','.pem','.key'] for n in files)
target.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
 for name,data in files.items():z.writestr(name,data)
with zipfile.ZipFile(target) as z:assert z.testzip() is None
print(json.dumps({'path':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'commit':head,'files':len(files)},indent=2))

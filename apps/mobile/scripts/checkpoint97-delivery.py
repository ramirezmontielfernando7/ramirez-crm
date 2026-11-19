"""Create a new offline delivery; no upload, compilation, signing or overwrite.
Usage from apps/mobile: python3 scripts/checkpoint97-delivery.py NEW.zip CURRENT.bundle
The bundle is cumulative after the preserved Offline f3f467a prerequisite.
"""
from pathlib import Path
import csv,hashlib,json,subprocess,sys,zipfile
root=Path.cwd();target=Path(sys.argv[1]);bundle=Path(sys.argv[2]).resolve()
assert not target.exists(),'Existing delivery is protected.'
assert bundle.is_file() and bundle.suffix=='.bundle'
assert not subprocess.check_output(['git','status','--porcelain'],text=True),'Commit first.'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();branch=subprocess.check_output(['git','branch','--show-current'],text=True).strip()
subprocess.run(['git','bundle','verify',str(bundle)],check=True,capture_output=True)
assert any(line.startswith(head+' ') for line in subprocess.check_output(['git','bundle','list-heads',str(bundle)],text=True).splitlines())
files={}
with zipfile.ZipFile('/workspace/entregables/Dashfort-Mobile-B-79-7ee7fd9.zip')as z:
 for name in z.namelist():
  if not name.startswith('respaldo/') and name not in ['SHA256SUMS.txt','manifest.json','index.html','LEEME.md']:files[name]=z.read(name)
for label,folder in [('agentes','agents'),('versiones','versions'),('asignaciones','assignments'),('evaluaciones','evaluations'),('asistente','assistant')]:
 base=root/'docs/refinement-b/evidence'/folder
 for p in base.rglob('*'):
  if p.is_file():files[label+'/'+str(p.relative_to(base))]=p.read_bytes()
for p in (root/'docs/refinement-b').glob('LOTE-*.md'):files['documentos/'+p.name]=p.read_bytes()
files['documentos/CHECKPOINT-97.md']=(root/'docs/refinement-b/CHECKPOINT-97.md').read_bytes()
files['respaldo/'+bundle.name]=bundle.read_bytes();files['inventario-158.csv']=(root/'docs/cobertura.csv').read_bytes()
with(root/'docs/cobertura.csv').open()as f:rows=list(csv.DictReader(f))
implemented=sum(r['Estado'].startswith('Implementada')for r in rows);assert implemented==97 and len(rows)==158
manifest={'branch':branch,'commit':head,'from':'a4268bf7608bd84fa034b7b5698aadae7bed78af','implementedIds':implemented,'pendingIds':61,'logicTests':351,'newActualCaptures':63,'newOfficialReferences':22,'apkBuilt':False,'nativeTestsPerformed':False,'backendCommit':'562a8b386b7f0d0df9292406167357aa988fd4d0','bundlePrerequisite':'f3f467abb7640ec13ffba590bc5dad91bc5cfd77','bundleSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'sourceBundleIncluded':True,'privateSigningFilesIncluded':False,'pushPerformed':False,'nextIds':['MORE-06','MORE-07','MORE-09','MORE-10','AST-04']}
files['manifest.json']=json.dumps(manifest,indent=2).encode()
files['LEEME.md']=f'''# Dashfort Mobile · 97/158

Rama: {branch}\nCommit: {head}\n351 pruebas de lógica; QA RN Web, no Android/iOS. Abra index.html sin conexión.

El ZIP contiene galerías e informes de los lotes anteriores y nuevos. Incluye un bundle Git acumulativo de los cambios Mobile posteriores a Offline f3f467abb7640ec13ffba590bc5dad91bc5cfd77. Conserve aquel paquete/base para recuperar el código; compruebe primero git bundle verify en un repositorio que contenga esa base y recupere el bundle hacia una rama local nueva. No use reset/main ni sobrescriba un árbol con trabajo pendiente.

Los archivos físicos anteriores se conservan. Este ZIP incluye un único bundle actualizado para evitar duplicarlo dentro del paquete; no borra ni sustituye sus respaldos previos. No contiene APK, firma privada ni backend preparado. La APK 0.1.2 y su clave siguen en sus respaldos originales. No existe una nueva APK por falta de espacio seguro para Gradle. No se subió ni desplegó nada.

Siguiente lote: MORE-06/07/09/10 + AST-04, solo simulaciones sin billing, IA ni servicios reales. Backend reservado para Claude permanece en 562a8b3, sin modificaciones/arranque.
'''.encode()
files['index.html']='''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashfort · checkpoint 97</title><style>body{max-width:960px;margin:auto;padding:24px;font:16px/1.6 system-ui;background:#f5f5f7;color:#1d1d1f}a{color:#0b6a6d}li{margin:10px 0}</style><h1>Dashfort Mobile · 97/158 IDs</h1><p>351 pruebas de lógica aprobadas, 61 IDs pendientes. Estudio IA completo en simulación y Asistente local AST-01/02/03. QA web: no acredita Android/iOS ni una APK nueva.</p><ul><li><a href="versiones/comparacion.html">Publicación local, versiones y pausa LAB-05/06/06C/07</a></li><li><a href="asignaciones/comparacion.html">Asignación LAB-20/21</a></li><li><a href="evaluaciones/comparacion.html">Pruebas simuladas LAB-30/31</a></li><li><a href="asistente/comparacion.html">Asistente AST-01/02/03</a></li><li><a href="agentes/comparacion.html">Agentes del checkpoint anterior</a></li><li><a href="conocimiento/comparacion.html">Conocimiento</a> · <a href="tareas-notas/comparacion.html">Tareas/Notas</a> · <a href="resultados/comparacion.html">Resultados</a></li><li><a href="b/index.html">B original y comparación</a> · <a href="biblioteca/index.html">Biblioteca</a> · <a href="agenda/index.html">Agenda</a></li><li><a href="documentos/CHECKPOINT-97.md">Informe y siguiente lote exacto</a></li><li><a href="inventario-158.csv">Inventario de los 158 IDs</a></li><li><a href="manifest.json">Commit y respaldo</a> · <a href="LEEME.md">Recuperación</a></li></ul><p>63 capturas nuevas de implementación y 22 referencias, ambos temas/tamaños; sin imágenes conceptuales, red de aplicación, IA/crédito real, push o despliegues. El bundle de código requiere conservar la base Offline anterior.</p></html>'''.encode()
assert not any(Path(name).suffix.lower()in['.apk','.jks','.keystore','.p12','.pfx','.key','.pem']for name in files)
files['SHA256SUMS.txt']=''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n'for name,data in sorted(files.items())).encode()
target.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as z:
 for name,data in files.items():z.writestr(name,data)
with zipfile.ZipFile(target)as z:assert z.testzip()is None
print(json.dumps({'path':str(target),'commit':head,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':len(files)},indent=2))

"""Assemble visual evidence and reports only. No APK, signing material, source bundle or upload."""
import base64
import csv
import re
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile
from PIL import Image, ImageChops

root = Path.cwd()
docs = root / 'docs/refinement-b'
library = docs / 'evidence/library-navigation'
if not library.exists(): library = docs / 'evidence/library'
agenda = docs / 'evidence/agenda'
destination = Path(sys.argv[1])
if destination.exists(): raise SystemExit('Choose a new delivery filename; existing backups are preserved.')
comparisons = []
for screen in ['crm', 'contacts']:
    for theme in ['light', 'dark']:
        for size in ['390x844', '360x640']:
            a = Image.open(docs / 'evidence' / f'implemented-{screen}-{theme}-{size}.png').convert('RGB')
            b = Image.open(library / f'regression-{screen}-{theme}-{size}.png').convert('RGB')
            delta = ImageChops.difference(a, b)
            pixels = list(delta.get_flattened_data())
            peak = max(max(p) for p in pixels)
            changed = sum(p != (0, 0, 0) for p in pixels)
            assert peak <= 1 and changed < 100, f'Unexpected shared-component visual regression: {screen}/{theme}/{size}'
            comparisons.append({'screen': screen, 'theme': theme, 'size': size, 'changedPixels': changed, 'maximumChannelDelta': peak, 'geometryChanged': False})
images = {p.name: 'data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode() for p in library.glob('*.png')}
gallery = '''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashfort · Biblioteca</title>
<style>body{font:15px/1.5 system-ui;margin:24px;background:#eef1f4;color:#1e293b}h1{font-size:25px}label{display:inline-flex;gap:8px;margin:8px}select{font:inherit;padding:8px}#wrap{overflow:auto;padding:16px 0}#grid{display:flex;gap:20px;width:max-content}figure{margin:0}figcaption{font-weight:600;padding:6px}img{display:block;width:100%;height:auto;box-shadow:0 0 0 1px #ccd3da}p{max-width:1000px}</style>
<h1>Biblioteca · lote 01 de continuación</h1><p><a href="../index.html">Volver a la entrega</a></p>
<label>Pantalla<select id="screen"><option>CRM-40</option><option>CRM-41</option><option>CRM-42</option></select></label><label>Tema<select id="theme"><option value="light">Claro</option><option value="dark">Oscuro</option></select></label><label>Tamaño<select id="size"><option>390x844</option><option>360x640</option></select></label>
<div id="wrap"><div id="grid"></div></div><p>Izquierda: maqueta original aprobada (su tamaño original). Derecha: componentes React Native reales renderizados sin conexión en Chromium, en el tamaño elegido. Los cambios B se limitan a las medidas aprobadas. Se utilizan datos ficticios; los tamaños de texto de muestra y las cantidades pueden diferir de la maqueta.</p><p>La demostración usa almacenamiento/router/sesión de prueba, listas, proveedores y capas reales. No sustituye pruebas Android/iOS. No se seleccionan archivos del dispositivo ni se envían documentos o mensajes.</p>
<script>const images=IMAGES;const el=id=>document.getElementById(id);function draw(){const s=el('screen').value,t=el('theme').value,z=el('size').value,w=Number(z.split('x')[0]);el('grid').innerHTML=[['Maqueta original',images['reference-'+s+'-'+t+'.png'],390],['Implementación B · '+z,images[s+'-'+t+'-'+z+'.png'],w]].map(([l,img,width])=>'<figure style="width:'+width+'px"><figcaption>'+l+'</figcaption><img alt="'+l+'" src="'+img+'"></figure>').join('')}['screen','theme','size'].forEach(id=>el(id).onchange=draw);draw();</script></html>'''.replace('IMAGES', json.dumps(images))

agenda_gallery = None
if agenda.exists():
    agenda_images = {p.name: 'data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode() for p in agenda.glob('*.png')}
    agenda_gallery = gallery.replace(json.dumps(images),json.dumps(agenda_images),1).replace('Dashfort · Biblioteca','Dashfort · Agenda').replace('Biblioteca · lote 01 de continuación','Agenda · lote 02 de continuación').replace('<option>CRM-40</option><option>CRM-41</option><option>CRM-42</option>',''.join(f'<option>CRM-{i}</option>' for i in range(20,26))).replace('No se seleccionan archivos del dispositivo ni se envían documentos o mensajes.','No se abren proveedores, se crean citas reales ni se envían recordatorios.')

files = {}
with zipfile.ZipFile(root / 'artifacts/refinement-b/Dashfort-B-Implementada-Evidencias.zip') as archive:
    for name in archive.namelist(): files['b/' + name] = archive.read(name)
files['biblioteca/index.html'] = gallery.encode()
files.update({'biblioteca/evidencias/' + p.name: p.read_bytes() for p in library.iterdir() if p.is_file()})
if agenda_gallery:
    files['agenda/index.html']=agenda_gallery.encode()
    files.update({'agenda/evidencias/'+p.name:p.read_bytes() for p in agenda.iterdir() if p.is_file()})
for name in ['RESULTADOS.md', 'ESPACIO-Y-APK.md', 'LOTE-01-BIBLIOTECA.md', 'LOTE-02-AGENDA.md']:
    files['documentos/' + name] = (docs / name).read_bytes()
files['evidencias/disk-recovery.json'] = (docs / 'evidence/disk-recovery.json').read_bytes()
files['evidencias/regresion-b-tras-biblioteca.json'] = json.dumps(comparisons, indent=2).encode()
for name in ['final-logic.txt', 'final-types.txt', 'final-format.txt']:
    current=(agenda/name) if (agenda/name).exists() else docs/'evidence'/name
    files['evidencias/' + name] = current.read_bytes()
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip()
with (root/'docs/cobertura.csv').open(newline='') as f: coverage=list(csv.DictReader(f))
implemented=sum(r['Estado'].startswith('Implementada') for r in coverage)
pending=len(coverage)-implemented
test_match=re.search(r'ℹ tests (\d+)',files['evidencias/final-logic.txt'].decode())
assert test_match
logic_tests=int(test_match[1])
manifest = {'branch': branch, 'commit': head, 'baselineOffline': 'f3f467abb7640ec13ffba590bc5dad91bc5cfd77', 'originalLab': '7f068daf10e8e2b78f81bdc4c953887352d39587', 'backendUnchanged': '562a8b386b7f0d0df9292406167357aa988fd4d0', 'implementedIds': implemented, 'pendingIds': pending, 'totalIds': len(coverage), 'logicTests': logic_tests, 'apkBuilt': False, 'nativeTestsPerformed': False, 'gitPushPerformed': False, 'privateSigningFilesIncluded': False, 'sourceBundleIncluded': False}
files['manifest.json'] = json.dumps(manifest, indent=2).encode()
files['index.html'] = '''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashfort · checkpoint B</title><style>body{max-width:900px;padding:24px;margin:auto;font:16px/1.6 system-ui;background:#f5f5f7;color:#1d1d1f}a{color:#0b6a6d}li{margin:12px 0}h1{font-size:28px}small{color:#48484d}</style><h1>Dashfort Mobile · B y continuación</h1><p>Todo este paquete se abre sin conexión. Solo contiene evidencias y documentación, sin APK, código de backend ni claves.</p><ul><li><a href="b/index.html">Comparar B original / anterior / implementada</a> · Bandeja, Contactos, Pipeline y Chat; ambos temas y tamaños.</li><li><a href="biblioteca/index.html">Biblioteca CRM-40/41/42 frente a la maqueta</a> · ambos temas y tamaños.</li><li><a href="documentos/ESPACIO-Y-APK.md">Diagnóstico del disco y alternativa para la APK</a> · 1,64 GiB recuperados; aún sin margen seguro para Gradle.</li><li><a href="documentos/LOTE-01-BIBLIOTECA.md">Lote, pruebas y siguiente checkpoint</a> · 64/158 IDs; 94 pendientes; 221 pruebas de lógica.</li><li><a href="manifest.json">Rama y commit exactos</a>.</li></ul><p>No se ha generado una APK nueva. La versión 0.1.2 y la firma anterior permanecen intactas. No se arrancó Gradle, backend ni PostgreSQL. Sin push, PR, merge, despliegues, servicios remotos de build o costos.</p><p><small>RN Web y Chromium sin red. Las pruebas nativas de teclado, scroll, accesibilidad y notificaciones siguen pendientes. El siguiente lote autorizado es Agenda CRM-20…25; este checkpoint no completa las 94 pantallas restantes.</small></p></html>'''.encode()
if agenda_gallery:
    index_html=files['index.html'].decode().replace('<li><a href="biblioteca/index.html">','<li><a href="agenda/index.html">Agenda CRM-20…25 frente a las maquetas</a> · ambos temas y tamaños.</li><li><a href="biblioteca/index.html">').replace('documentos/LOTE-01-BIBLIOTECA.md','documentos/LOTE-02-AGENDA.md').replace('64/158 IDs; 94 pendientes; 221 pruebas de lógica.',f'{implemented}/158 IDs; {pending} pendientes; {logic_tests} pruebas de lógica.').replace('El siguiente lote autorizado es Agenda CRM-20…25; este checkpoint no completa las 94 pantallas restantes.',f'El siguiente lote autorizado es Tareas/Notas CRM-30…33; este checkpoint no completa las {pending} pantallas restantes.')
    files['index.html']=index_html.encode()
files['SHA256SUMS.txt'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(files.items())).encode()
assert not any(Path(name).suffix.lower() in ['.apk', '.keystore', '.jks', '.p12', '.pfx', '.bundle'] for name in files)
destination.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in files.items(): archive.writestr(name, data)
with zipfile.ZipFile(destination) as archive: assert archive.testzip() is None
print(json.dumps({'path': str(destination), 'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'commit': head, 'fileCount': len(files)}, indent=2))

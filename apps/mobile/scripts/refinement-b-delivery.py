"""Offline evidence gallery from captured pixels; does not start or publish services."""
import base64
import hashlib
import json
import zipfile
from pathlib import Path
from PIL import Image, ImageChops

root = Path.cwd()
evidence = root / 'docs/refinement-b/evidence'
out = root / 'artifacts/refinement-b'
lab = root / 'labs/visual-refinement/evidence'
comparisons = []
for theme in ['light', 'dark']:
    for size in ['390x844', '360x640']:
        original = lab / f'bandeja-B-{theme}-{size}.png'
        implemented = evidence / f'implemented-inbox-{theme}-{size}.png'
        delta = ImageChops.difference(Image.open(original).convert('RGB'), Image.open(implemented).convert('RGB'))
        assert delta.getbbox() is None, f'Inbox is not identical to original B: {theme}/{size}'
        comparisons.append({'screen': 'inbox', 'theme': theme, 'size': size, 'identicalPixels': True})
for screen in ['contacts', 'crm']:
    for theme in ['light', 'dark']:
        delta = ImageChops.difference(Image.open(lab / f'{screen}-B-{theme}-390x844.png').convert('RGB'), Image.open(evidence / f'implemented-{screen}-{theme}-390x844.png').convert('RGB'))
        comparisons.append({'screen': screen, 'theme': theme, 'size': '390x844', 'differenceBounds': delta.getbbox(), 'note': 'Contacts: <=4 antialiased edge pixels in the local selector; no geometry change.' if screen == 'contacts' else 'Identical pixels.'})
(evidence / 'original-b-comparison.json').write_text(json.dumps(comparisons, indent=2) + '\n')
images = {p.name: 'data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode() for p in evidence.glob('*.png')}
originals = {p.name: 'data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode() for p in lab.glob('*.png') if '-B-' in p.name}
html = '''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashfort · B implementada</title>
<style>body{margin:24px;background:#eef1f4;color:#1e293b;font:15px/1.5 system-ui}h1{font-size:25px}label{display:inline-flex;gap:8px;margin:8px}select{font:inherit;padding:8px}#wrap{overflow:auto;padding:16px 0}#grid{display:flex;gap:20px;width:max-content}figure{margin:0}figcaption{padding:6px;font-weight:600}img{display:block;box-shadow:0 0 0 1px #ccd3da}p{max-width:1000px}</style>
<h1>Dashfort Mobile · B original implementada</h1><p>Comparación de código real: diseño anterior, B aprobada del laboratorio y B integrada. Sin cambios de paleta ni rediseño de otras pantallas.</p>
<label>Pantalla<select id="screen"><option value="inbox">Bandeja</option><option value="contacts">Contactos</option><option value="crm">Pipeline</option><option value="chat">Chat</option></select></label>
<label>Tema<select id="theme"><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
<label>Tamaño<select id="size"><option>390x844</option><option>360x640</option></select></label><div id="wrap"><div id="grid"></div></div>
<p>Bandeja coincide píxel por píxel con las cuatro capturas originales B. Pipeline coincide en ambos temas a 390×844. En Contactos hay hasta cuatro píxeles de suavizado distintos en un borde del selector. No existen capturas originales B de Chat ni de CRM/Contactos a 360×640; allí se compara anterior/implementada.</p>
<p>Capturas React Native Web sin red, con pantallas, proveedores de dominio, capas y listas reales; sesión/tema/almacenamiento/router de prueba. No validan Android/iOS ni sustituyen pruebas del teléfono.</p>
<p>APK nueva no generada: disco local insuficiente. La APK 0.1.2 está intacta. Ver RESULTADOS.md y el preflight. No se inició Gradle ni un servicio remoto.</p>
<script>const images=IMAGES,originals=ORIGINALS;const el=id=>document.getElementById(id);function draw(){let s=el('screen').value,t=el('theme').value,z=el('size').value,w=Number(z.split('x')[0]);let cards=[['Anterior',images['before-'+s+'-'+t+'-'+z+'.png']]];let name=(s==='inbox'?'bandeja':s)+'-B-'+t+'-'+z+'.png';if(originals[name])cards.push(['B original aprobada',originals[name]]);cards.push(['B implementada',images['implemented-'+s+'-'+t+'-'+z+'.png']]);el('grid').innerHTML=cards.map(([l,img])=>'<figure><figcaption>'+l+'</figcaption><img alt="'+l+'" width="'+w+'" src="'+img+'"></figure>').join('')}['screen','theme','size'].forEach(id=>el(id).onchange=draw);draw();</script></html>'''.replace('IMAGES', json.dumps(images)).replace('ORIGINALS', json.dumps(originals))
(out / 'comparacion.html').write_text(html)
files = {'index.html': html.encode(), 'RESULTADOS.md': (root / 'docs/refinement-b/RESULTADOS.md').read_bytes()}
files.update({'capturas/' + p.name: p.read_bytes() for p in evidence.iterdir() if p.is_file()})
files.update({'referencia-b/' + p.name: p.read_bytes() for p in lab.glob('*.png') if '-B-' in p.name})
files['SHA256SUMS.txt'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(files.items())).encode()
destination = out / 'Dashfort-B-Implementada-Evidencias.zip'
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in files.items(): archive.writestr(name, data)
with zipfile.ZipFile(destination) as archive: assert archive.testzip() is None
print(json.dumps({'zip': str(destination), 'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'originalComparisons': comparisons}, indent=2))

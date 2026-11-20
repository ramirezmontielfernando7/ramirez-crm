import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {settle} from './qa-settle.mjs';
export async function runFinal(context,html,root,requests) {
 const out=path.join(root,'artifacts/final-screens');fs.mkdirSync(out,{recursive:true});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('FINAL_ERROR',e.message)});
 await p.setContent(html);await p.waitForFunction(()=>window.mountRefinement);
 const nav=async r=>{await p.evaluate(r=>window.qaNavigate(r),r);await settle(p)},b=n=>p.getByRole('button',{name:n,exact:true}),text=n=>p.getByText(n,{exact:true});
 let checks=0;const ok=()=>checks++;
 await p.evaluate(()=>{window.qaUseProfile=true;window.mountRefinement('more','light')});await text('Fer Ramírez').waitFor();
 const prompt=b('Recordármelo en 3 días');if(await prompt.isVisible())await prompt.click();
 await b('Ajustes').click();await p.getByRole('heading',{name:'Ajustes',exact:true}).waitFor();ok();
 await p.getByRole('textbox',{name:'Buscar un ajuste'}).fill('noexisting');await text('Sin resultados').waitFor();ok();
 await p.getByRole('textbox',{name:'Buscar un ajuste'}).fill('etiquetas');await b('Etiquetas').click();await p.getByRole('heading',{name:'Etiquetas',exact:true}).waitFor();ok();
 await nav('/platform-panel');await text('Acceso no permitido').waitFor();assert.equal(await b('Plataforma').count(),0);ok();
 await nav('/platform-lab');await b('Confirmar acceso a metadatos ficticios').click();await b('Abrir Plataforma').click();await p.getByRole('heading',{name:'Plataforma',exact:true}).waitFor();await text('Actividad reciente').waitFor();ok();
 await p.getByRole('tab',{name:'Organizaciones',exact:true}).click();await b('Joyería Cristal').click();await p.getByRole('heading',{name:'Joyería Cristal',exact:true}).waitFor();ok();
 for(const label of ['IA y topes','Consumo','Accesos','Plan y módulos']){await p.getByRole('tab',{name:label,exact:true}).click();await settle(p);ok()}
 await nav('/platform-detail?id=unknown');await text('Organización no disponible').waitFor();ok();
 await nav('/appearance');await p.getByRole('radio',{name:'Oscuro',exact:true}).click();await p.waitForFunction(()=>window.qaPersonalization().snapshot().personal.theme==='dark');assert.equal(await p.getByRole('radio',{name:'Oscuro',exact:true}).getAttribute('aria-checked'),'true');ok();
 await p.getByRole('radio',{name:'Geist',exact:true}).click();await p.waitForFunction(()=>window.qaPersonalization().snapshot().personal.font==='Geist');await p.waitForFunction(()=>getComputedStyle([...document.querySelectorAll('[role=heading]')].find(e=>e.textContent==='Apariencia')).fontFamily.includes('Geist_'));ok();
 await p.getByRole('radio',{name:'Estilo WhatsApp',exact:true}).click();await p.waitForFunction(()=>window.qaPersonalization().snapshot().personal.chat==='whatsapp');ok();
 await nav('/conversation/demo-conv-1');const incoming=p.locator('[aria-label^="Cliente:"]').first();await incoming.waitFor();assert.equal(await incoming.evaluate(e=>getComputedStyle(e.parentElement).borderBottomRightRadius),'8px');await p.evaluate(()=>window.qaPersonalization().personal({chat:'classic'}));await p.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label^="Cliente:"]').parentElement).borderBottomRightRadius==='16px');ok();
 await nav('/brand');await p.getByRole('textbox',{name:'Nombre del CRM'}).fill('Dashfort Muestra');await p.getByRole('radio',{name:'Acento #2563eb',exact:true}).click();await b('Guardar marca').click();await p.waitForFunction(()=>window.qaPersonalization().snapshot().brand.name==='Dashfort Muestra');ok();
 await b('Logo e ícono').click();await b('Usar marca de muestra').click();await p.waitForFunction(()=>window.qaPersonalization().snapshot().brand.asset==='sample');ok();
 await nav('/more');await text('Dashfort Muestra by Demfort · versión 0.1.3 (demo)').waitFor();ok();
 await nav('/navigation-settings');await p.getByRole('switch',{name:'Marketing',exact:true}).click();await p.waitForFunction(()=>!window.qaPersonalization().snapshot().brand.menus.owner.includes('marketing'));await nav('/more');assert.equal(await p.getByRole('tab',{name:'Marketing',exact:true}).count(),0);await b('Marketing').click();await p.getByRole('heading',{name:'Marketing',exact:true}).waitFor();ok();
 await nav('/navigation-settings');await b('Orden del menú').click();await b('Bajar Bandeja').click();await p.waitForFunction(()=>window.qaPersonalization().snapshot().brand.menus.owner[0]==='crm');await b('Cerrar').click();await nav('/more');const tabs=await p.getByRole('tab').allTextContents();assert.equal(tabs[0].trim(),'CRM');assert.equal(tabs.at(-1).trim(),'Más');ok();
 // Failed writes must display an actionable error and leave the committed preference unchanged.
 await nav('/appearance');await p.evaluate(()=>window.qaFailWrite=true);await p.getByRole('radio',{name:'Claro',exact:true}).click();await text('Escritura local simulada').waitFor();assert.equal(await p.evaluate(()=>window.qaPersonalization().snapshot().personal.theme),'dark');await p.evaluate(()=>window.qaFailWrite=false);ok();
 // Restore original B before comparison captures.
 await p.evaluate(async()=>{const s=window.qaPersonalization();await s.brand({name:'Dashfort',accent:'#0e7c80',asset:'original'});await s.menu('owner',['inbox','crm','studio','marketing','more']);await s.personal({theme:'light',font:'Inter',chat:'classic'})});
 for(const theme of ['light','dark']){
  await p.setViewportSize({width:390,height:844});await p.evaluate(async theme=>{await window.qaPersonalization().personal({theme})},theme);
  for(const [id,r] of [['PLT-01','/platform-panel'],['PLT-02','/platform-organizations'],['PLT-03','/platform-detail?id=o2'],['SET-01','/settings'],['SET-15','/appearance'],['SET-16','/brand'],['SET-17','/navigation-settings'],['MORE-01','/more']]){await nav(r);await p.screenshot({path:path.join(out,`${id}-${theme}-390x844.png`)});ok()}
 }
 // Compact viewport: all actions and horizontal tabs remain reachable; avoid redundant screenshots.
 await p.setViewportSize({width:360,height:640});await nav('/platform-detail?id=o2');await p.getByRole('tab',{name:'Accesos',exact:true}).click();await text('Sin sesiones, credenciales ni contenido del negocio.').waitFor();await nav('/settings');await b('Navegación').click();await b('Restaurar menú del rol').click();ok();
 await p.evaluate(()=>window.mountRefinement('more','light','coordinator'));await settle(p);await b('Ajustes').waitFor();assert.equal(await b('Plataforma').count(),0);await b('Ajustes').click();assert.equal(await b('Uso y plan').count(),0);assert.equal(await b('Conector del equipo').count(),0);assert.equal(await b('Marca').count(),0);ok();
 await nav('/brand');await text('Solo el propietario administra la marca de su organización ficticia.').waitFor();await nav('/navigation-settings');await text('Solo el propietario configura el menú por rol.').waitFor();ok();
 await p.evaluate(()=>window.mountRefinement('more','light','advisor'));await settle(p);await text('Luis Ortega').waitFor();assert.equal(await b('Ajustes').count(),0);assert.equal(await b('Uso y plan').count(),0);assert.equal(await b('Resultados').count(),0);assert.equal(await b('Plataforma').count(),0);ok();
 await nav('/settings');await text('Acceso no permitido').waitFor();await nav('/platform-panel');await text('Acceso no permitido').waitFor();ok();
 await p.evaluate(()=>{window.qaFailPersonalizationRead=true;window.mountRefinement('more','light','owner')});await settle(p);await text('No pudimos cargar los datos').waitFor();await p.evaluate(()=>window.qaFailPersonalizationRead=false);await b('Reintentar').click();await text('Fer Ramírez').waitFor();ok();await p.waitForFunction(()=>window.qaPersonalization().snapshot().ready);assert.equal(await p.evaluate(()=>window.qaPersonalization().snapshot().personal.font),'Inter');assert.equal(await b('Plataforma').count(),0);ok();
 await b('Tema oscuro').click();await p.waitForFunction(()=>window.qaPersonalization().snapshot().personal.theme==='light');ok();
 await b('Cerrar sesión').click();await b('Cancelar').click();assert.equal(await p.evaluate(()=>!!window.qaLoggedOut),false);await b('Cerrar sesión').click();await p.evaluate(()=>window.qaFailLogout=true);await p.getByRole('dialog').getByRole('button',{name:'Cerrar sesión',exact:true}).click();await text('Cierre local simulado').waitFor();await p.evaluate(()=>window.qaFailLogout=false);await p.getByRole('dialog').getByRole('button',{name:'Cerrar sesión',exact:true}).click();await p.waitForFunction(()=>window.qaLoggedOut);ok();
 const ref=await context.newPage();await ref.setContent(fs.readFileSync(path.join(root,'docs/reference/dashfort-mobile-prototipo.html'),'utf8'));await ref.waitForFunction(()=>typeof go==='function');for(const theme of ['light','dark'])for(const id of ['PLT-01','PLT-02','PLT-03','SET-01','SET-15','SET-16','SET-17','MORE-01']){await ref.evaluate(({theme,id})=>{S.theme=theme;go(id)},{theme,id});await ref.locator('#ph').screenshot({path:path.join(out,`reference-${id}-${theme}.png`)})}await ref.close();
 assert.deepEqual(errors,[]);assert.equal(requests(),0);fs.writeFileSync(path.join(out,'resultados.json'),JSON.stringify({checks,errors,networkRequests:requests(),screens:8,captures:16,references:16,qa:'React Native Web; router/session/storage doubles; real personalization/theme providers; no Android/iOS validation'},null,2));console.log('FINAL_QA',JSON.stringify({checks,errors,networkRequests:requests()}));await p.close();
}

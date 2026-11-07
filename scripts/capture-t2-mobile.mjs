/** Capturas T2 y comparaciones con la lámina 42 de ronda 3.
 * Requiere la app LOCAL con base demo, usuario e2e y Conexión directa habilitada.
 * No siembra datos ni envía mensajes. --references-only solo renderiza maquetas.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const dir = resolve('docs/capturas/t2-movil');
const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Solo se admiten bases locales de prueba');
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
try {
  const reference = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await reference.setContent(readFileSync('docs/maquetas/ronda3/prototipo-ronda3.html', 'utf8'));
  const phones = await reference.locator('#movil .frame > .row > div').evaluateAll(nodes => nodes.map(n => n.outerHTML));
  assert.equal(phones.length, 3, 'La lámina 42 debe contener tres teléfonos');
  for (const [index, name] of ['bandeja', 'chat'].entries()) {
    await reference.evaluate(html => {
      document.body.innerHTML = html;
      Object.assign(document.body.style, { padding: '0', margin: '0', background: '#fff' });
      const phone = document.body.firstElementChild;
      Object.assign(phone.style, { width: '390px', height: '844px', padding: '0', borderRadius: '0', boxShadow: 'none' });
      const inner = phone.firstElementChild;
      Object.assign(inner.style, { width: '100%', height: '100%', borderRadius: '0' });
      inner.firstElementChild.remove(); // Marco y barra del sistema no pertenecen a la app.
    }, phones[index]);
    await reference.setViewportSize({ width: 390, height: 844 });
    await reference.screenshot({ path: `${dir}/referencia-${name}-390.png` });
  }
  await reference.close();
  if (!process.argv.includes('--references-only')) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await context.addCookies([
      { name: 'vocero-theme', value: 'light', url: base },
      { name: 'vocero-ui-style', value: 'classic', url: base },
      { name: 'vocero-chat-style', value: 'classic', url: base },
    ]);
    const login = await context.request.post(`${base}/api/auth/sign-in/email`, {
      headers: { origin: base },
      data: { email: process.env.CAPTURE_EMAIL ?? 'e2e@vocero.test', password: process.env.CAPTURE_PASSWORD ?? 'password-e2e-123' },
    });
    assert(login.ok(), 'No se pudo entrar con el usuario de prueba');
    await context.route('**/api/events*', route => route.abort());
    const page = await context.newPage();
    const shot = async name => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
    };
    await page.goto(`${base}/inbox`);
    await page.locator('[data-row-main]').first().waitFor();
    const filters = page.getByRole('group', { name: 'Mostrar', exact: true });
    await filters.getByRole('button', { name: /^Grupos/ }).waitFor();
    assert.deepEqual(await filters.getByRole('button').allTextContents().then(names => names.map(n => n.replace(/\d+/g, '').trim())), ['Todos', 'No leídos', 'Míos', 'Campañas', 'Grupos']);
    const tops = await filters.getByRole('button').evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, 'Los cinco filtros deben compartir fila');
    await shot('bandeja-390');
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/conversations?') && r.ok()),
      filters.getByRole('button', { name: /^Grupos/ }).click(),
    ]);
    assert.equal(await filters.getByRole('button', { name: /^Grupos/ }).getAttribute('aria-pressed'), 'true');
    await shot('grupos-390');
    await filters.getByRole('button', { name: 'Todos', exact: true }).click();
    await page.locator('[data-row-main]').first().waitFor();
    await page.locator('[data-row-main]').first().click();
    await page.getByPlaceholder('Escribe un mensaje').waitFor();
    await page.locator('.bubble').first().waitFor();
    await page.getByTestId('chat-mode-chip').waitFor();
    const composer = await page.locator('[data-pm="composer"]').boundingBox();
    assert(composer.y + composer.height <= 844 && composer.height <= 110, 'El compositor vacío debe quedar compacto y dentro de la pantalla');
    await shot('chat-390');
    await page.getByTestId('chat-mode-chip').click();
    const picker = page.getByTestId('chat-mode-picker');
    await picker.waitFor();
    const rect = await picker.boundingBox();
    assert(rect.x >= 0 && rect.x + rect.width <= 390, 'La selección de conexión debe caber en el teléfono');
    await shot('conexion-390');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Opciones del chat', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Ver historial' }).waitFor();
    await shot('chat-menu-390');
    await page.getByRole('menuitem', { name: 'Ver historial' }).click();
    await page.getByRole('region', { name: 'Actividad del chat' }).waitFor();
    await shot('historial-390');
    await page.getByRole('button', { name: 'Ocultar panel', exact: true }).click();
    await page.getByRole('button', { name: 'Volver a las conversaciones' }).click();
    await page.getByRole('button', { name: 'Abrir el menú', exact: true }).click();
    await page.locator('aside').getByRole('link', { name: /Bandeja/ }).waitFor();
    await shot('mas-390');
    await page.locator('aside').getByRole('link', { name: /Ajustes/ }).click();
    await page.getByRole('navigation', { name: 'Secciones de Ajustes' }).waitFor();
    await page.locator('nav[aria-label="Secciones de Ajustes"] [aria-current="page"]').first().waitFor();
    await shot('ajustes-390');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/inbox`);
    await page.locator('[data-row-main]').first().waitFor();
    await shot('escritorio-1440');
    const before = await page.screenshot({ animations: 'disabled' });
    await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
          const css = sheet.cssRules[i].cssText;
          if (css.includes('.inbox-list-header .seg') || css.includes('.app-nav > nav') || css.includes(':has(.settings-search)')) sheet.deleteRule(i);
        }
      }
    });
    const after = await page.screenshot({ animations: 'disabled' });
    assert(before.equals(after), 'Las reglas de T2 no deben alterar el escritorio');
    writeFileSync(`${dir}/verificacion-escritorio.txt`, '1440 × 900; reglas T2 activas vs eliminadas: capturas idénticas\n');
    await context.close();
    const compare = await browser.newPage({ viewport: { width: 828, height: 910 }, deviceScaleFactor: 1 });
    for (const name of ['bandeja', 'chat']) {
      const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#f5f5f7;font:14px system-ui;color:#1d1d1f}.pair{display:flex;gap:16px}figure{margin:0}figcaption{height:32px;font-weight:500}img{display:block;width:390px;height:844px}</style><div class="pair"><figure><figcaption>Referencia · ronda 3, lámina 42 · 390 px</figcaption><img src="referencia-${name}-390.png"></figure><figure><figcaption>Dashfort · implementación · 390 px</figcaption><img src="${name}-390.png"></figure></div>`;
      writeFileSync(`${dir}/comparacion-${name}.html`, html);
      await compare.setContent(html.replace(/src="([^"]+)"/g, (_, file) => `src="data:image/png;base64,${readFileSync(`${dir}/${file}`).toString('base64')}"`));
      await compare.screenshot({ path: `${dir}/comparacion-${name}-390.png` });
    }
    console.log('T2: cinco chips, conexión, historial, compositor y escritorio verificados. Capturas generadas.');
  }
} finally {
  await browser.close();
}

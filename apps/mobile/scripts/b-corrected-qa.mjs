import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runCorrected(
  context,
  original,
  corrected,
  root,
  requests,
) {
  const out = path.join(root, "docs/original-corregido/evidence");
  fs.mkdirSync(out, { recursive: true });
  const pages = [],
    errors = [],
    checks = [],
    geometry = [];
  const check = (name, fn) => {
    fn();
    checks.push(name);
  };
  async function pageFor(html) {
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.setContent(html);
    await p.waitForFunction(() => window.mountRefinement);
    pages.push(p);
    return p;
  }
  async function mount(p, screen, theme) {
    await p.evaluate(
      ({ screen, theme }) => window.mountRefinement(screen, theme),
      { screen, theme },
    );
    await settle(p);
    await p.getByRole("heading").first().waitFor();
    await p.evaluate(() => document.fonts.ready);
    await settle(p);
  }
  const waitIndicator = (p) =>
    p.waitForFunction(() => {
      const track = document.querySelector("[data-testid=original-segments]");
      const selected = track?.querySelector("[role=tab][aria-selected=true]");
      const indicator = track?.querySelector(
        "[data-testid=original-segment-indicator]",
      );
      if (!selected || !indicator) return false;
      return (
        Math.abs(
          selected.getBoundingClientRect().left -
            indicator.getBoundingClientRect().left,
        ) < 0.5
      );
    });
  const before = await pageFor(original),
    after = await pageFor(corrected);
  for (const width of [390, 360])
    for (const theme of ["light", "dark"])
      for (const screen of ["inbox", "chat", "crm"]) {
        const height = width === 390 ? 844 : 640;
        for (const [name, p] of [
          ["original", before],
          ["corregido", after],
        ]) {
          await p.setViewportSize({ width, height });
          await mount(p, screen, theme);
          await p.screenshot({
            path: path.join(out, `${name}-${screen}-${theme}-${width}.png`),
          });
        }
        const heading = async (p) =>
          p
            .getByRole("heading")
            .first()
            .evaluate((e) => {
              const s = getComputedStyle(e),
                r = e.getBoundingClientRect();
              return {
                font: s.fontFamily,
                size: s.fontSize,
                weight: s.fontWeight,
                color: s.color,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
              };
            });
        const h1 = await heading(before),
          h2 = await heading(after);
        assert.deepEqual(h2, h1);
        checks.push(`${screen}/${theme}/${width}: título B intacto`);
        if (screen !== "chat") {
          const dock = (p) =>
            p.getByRole("tablist", {
              name: "Navegación principal",
              exact: true,
            });
          assert.deepEqual(
            await dock(after).boundingBox(),
            await dock(before).boundingBox(),
          );
          const d1 = await dock(before).evaluate(
              (e) => getComputedStyle(e).borderRadius,
            ),
            d2 = await dock(after).evaluate(
              (e) => getComputedStyle(e).borderRadius,
            );
          check(`${screen}/${theme}/${width}: barra original, radio +2`, () => {
            assert.equal(d1, "22px");
            assert.equal(d2, "24px");
          });
        }
        if (screen === "crm") {
          const controls = (p) => p.getByRole("tablist").first();
          assert.deepEqual(
            await controls(after).boundingBox(),
            await controls(before).boundingBox(),
          );
          checks.push(
            `CRM/${theme}/${width}: cápsula conserva geometría original`,
          );
        }
        if (screen === "inbox") {
          const control = after.getByTestId("original-segments").first();
          const rect = await control.boundingBox();
          const cells = await control.getByRole("tab").evaluateAll((es) =>
            es.map((e) => {
              const r = e.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            }),
          );
          assert.equal(cells.length, 3);
          assert.ok(
            Math.max(...cells.map((r) => r.width)) -
              Math.min(...cells.map((r) => r.width)) <
              0.1,
          );
          await control.evaluate((e) => {
            window.qaOriginalControl = e;
          });
          for (const [label, key] of [
            ["Equipo", "team"],
            ["Mi número", "number"],
            ["Clientes", "clients"],
          ]) {
            await control
              .getByRole("tab", { name: label, exact: true })
              .click();
            await settle(after);
            await waitIndicator(after);
            assert.deepEqual(await control.boundingBox(), rect);
            assert.deepEqual(
              await control.getByRole("tab").evaluateAll((es) =>
                es.map((e) => {
                  const r = e.getBoundingClientRect();
                  return { x: r.x, y: r.y, width: r.width, height: r.height };
                }),
              ),
              cells,
            );
            assert.equal(
              await control.evaluate((e) => e === window.qaOriginalControl),
              true,
            );
            await after.getByTestId(`inbox-area-${key}`).waitFor();
            const active = await after
              .getByTestId(`inbox-area-${key}`)
              .getAttribute("aria-hidden");
            assert.notEqual(active, "true");
            const inactive = await after
              .locator("[data-testid^=inbox-area-][aria-hidden=true]")
              .count();
            assert.ok(inactive >= 1);
            assert.equal(
              await control
                .getByRole("tab", { name: label, exact: true })
                .getAttribute("aria-selected"),
              "true",
            );
            if (width === 390 && key !== "clients") {
              await before.evaluate(
                (key) => window.qaNavigate("/(tabs)/inbox?area=" + key),
                key,
              );
              await settle(before);
              await before.screenshot({
                path: path.join(out, `original-${key}-${theme}-${width}.png`),
              });
              await after.screenshot({
                path: path.join(out, `corregido-${key}-${theme}-${width}.png`),
              });
            }
            checks.push(
              `selector/${theme}/${width}/${key}: mismas tres posiciones, mismo nodo e indicador alineado`,
            );
          }
          geometry.push({ width, theme, track: rect, cells });
        }
      }
  await after.setViewportSize({ width: 390, height: 844 });
  await mount(after, "inbox", "light");
  const control = after.getByTestId("original-segments").first();
  await control.getByRole("tab", { name: "Equipo", exact: true }).click();
  await settle(after);
  const query = after.getByRole("textbox", {
    name: "Buscar persona o grupo",
    exact: true,
  });
  await query.fill("Ana");
  await settle(after);
  await control.getByRole("tab", { name: "Mi número", exact: true }).click();
  await settle(after);
  assert.equal(
    await after
      .getByRole("textbox", { name: "Buscar persona o grupo", exact: true })
      .count(),
    0,
  );
  checks.push("Panel inactivo fuera del árbol accesible");
  await control.getByRole("tab", { name: "Equipo", exact: true }).click();
  await settle(after);
  assert.equal(await query.inputValue(), "Ana");
  checks.push("Búsqueda de Equipo conservada sin remontar");
  await control.getByRole("tab", { name: "Clientes", exact: true }).click();
  await settle(after);
  // Client filters and virtual list position survive area changes without losing the measured viewport.
  await after.getByRole("button", { name: "No leídos", exact: true }).click();
  await settle(after);
  const scroller = after
    .locator(
      '[data-testid="inbox-area-clients"] [data-testid="conversation-list"]',
    )
    .first();
  assert.equal(await scroller.count(), 1);
  {
    await scroller.evaluate((e) => {
      e.scrollTop = 400;
    });
    await settle(after);
    const y = await scroller.evaluate((e) => e.scrollTop);
    assert.ok(y > 300, "La prueba debe desplazar realmente la lista");
    await control.getByRole("tab", { name: "Equipo", exact: true }).click();
    await settle(after);
    await control.getByRole("tab", { name: "Clientes", exact: true }).click();
    await settle(after);
    assert.ok(Math.abs((await scroller.evaluate((e) => e.scrollTop)) - y) < 2);
    checks.push("Scroll virtual conservado entre áreas");
  }
  assert.equal(
    await after
      .getByRole("button", { name: "No leídos", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  checks.push("Filtro Clientes conservado entre áreas");
  const savedY = await scroller.evaluate((e) => e.scrollTop);
  const rowLabel = await scroller.evaluate((e) => {
    const viewport = e.getBoundingClientRect();
    return [...e.querySelectorAll("[role=button]")]
      .find((row) => {
        const r = row.getBoundingClientRect();
        return r.top >= viewport.top && r.bottom <= viewport.bottom;
      })
      ?.getAttribute("aria-label");
  });
  assert.ok(rowLabel, "Hay una conversación visible para abrir");
  await after.getByRole("button", { name: rowLabel, exact: true }).click();
  await after
    .getByRole("button", { name: "Volver a Bandeja", exact: true })
    .waitFor();
  await after
    .getByRole("button", { name: "Volver a Bandeja", exact: true })
    .click();
  await settle(after);
  await after.waitForFunction(
    (y) =>
      Math.abs(
        document.querySelector("[data-testid=conversation-list]")?.scrollTop -
          y,
      ) < 3,
    savedY,
  );
  checks.push("Entrada y regreso del chat conservan ancla y filtro");
  // Interrupt an in-flight indicator and verify only the final selection wins.
  await after.evaluate(() => {
    const tabs = [
      ...document
        .querySelector("[data-testid=original-segments]")
        .querySelectorAll("[role=tab]"),
    ];
    tabs[1].click();
  });
  await settle(after);
  await control.getByRole("tab", { name: "Mi número", exact: true }).click();
  await control.getByRole("tab", { name: "Clientes", exact: true }).click();
  await waitIndicator(after);
  assert.equal(
    await control
      .getByRole("tab", { name: "Clientes", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  checks.push(
    "Cambios rápidos cancelan el indicador anterior sin aperturas repetidas",
  );
  await after.emulateMedia({ reducedMotion: "reduce" });
  await control.getByRole("tab", { name: "Equipo", exact: true }).click();
  await settle(after);
  await waitIndicator(after);
  checks.push("Preferencia reducir movimiento mantiene selección y geometría");
  await after.emulateMedia({ reducedMotion: "no-preference" });
  // Real forms and portal modal at a compact viewport. Web does not emulate a native IME.
  await mount(after, "inbox", "light");
  await after.evaluate(() => window.qaNavigate("/brand"));
  const input = after.getByRole("textbox", {
    name: "Nombre del CRM",
    exact: true,
  });
  await input.fill("Borrador local de prueba");
  await after.setViewportSize({ width: 390, height: 500 });
  await input.focus();
  await settle(after);
  assert.equal(await input.inputValue(), "Borrador local de prueba");
  checks.push("Formulario conserva texto al reducir viewport");
  await after
    .getByRole("button", { name: "Logo e ícono", exact: true })
    .click();
  await after.getByRole("button", { name: "Cerrar", exact: true }).click();
  assert.equal(await input.inputValue(), "Borrador local de prueba");
  checks.push("Modal real no pierde borrador del formulario");
  assert.deepEqual(errors, []);
  assert.equal(requests(), 0);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        baseline: "cd13180bd1521a6e39c9e93c21d8161b0918cb9b",
        checks,
        geometry,
        errors,
        networkRequests: requests(),
        captures: 32,
        nativeIMEValidated: false,
        P1: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "B_CORRECTED_QA",
    JSON.stringify({
      checks: checks.length,
      captures: 32,
      errors,
      networkRequests: requests(),
      nativeIMEValidated: false,
    }),
  );
  for (const p of pages) await p.close();
}

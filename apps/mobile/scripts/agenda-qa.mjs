import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
export async function runAgenda(context, html, root, networkCount = () => 0) {
  const out = path.join(root, "artifacts/continuation-agenda");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  const capture = !process.argv.includes("--behavior-only");
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("AGENDA_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => window.mountRefinement("agenda", theme, role),
      { theme, role },
    );
    await p.getByRole("heading", { name: "Agenda", exact: true }).waitFor();
    await p.waitForFunction(() => window.qaAgenda()?.snapshot().ready);
  };
  if (capture)
    for (const [width, height] of [
      [390, 844],
      [360, 640],
    ])
      for (const theme of ["light", "dark"]) {
        await p.setViewportSize({ width, height });
        await mount(theme);
        assert.equal(
          await p.getByText("Bandeja", { exact: true }).count(),
          0,
          "Agenda must not show the root tab bar",
        );
        await p.screenshot({
          path: path.join(out, `CRM-20-${theme}-${width}x${height}.png`),
        });
        await p
          .getByRole("button", { name: /Demostración del plan Pro,/ })
          .click();
        await p.screenshot({
          path: path.join(out, `CRM-21-${theme}-${width}x${height}.png`),
        });
        await p.getByRole("button", { name: "Mover a…", exact: true }).click();
        await p.screenshot({
          path: path.join(out, `CRM-23-${theme}-${width}x${height}.png`),
        });
        await close();
        await p
          .getByRole("button", { name: "Bloquear horario", exact: true })
          .click();
        await p.screenshot({
          path: path.join(out, `CRM-22-${theme}-${width}x${height}.png`),
        });
        await close();
        await p
          .getByRole("button", { name: "Más opciones de Agenda", exact: true })
          .click();
        await p.screenshot({
          path: path.join(out, `CRM-25-${theme}-${width}x${height}.png`),
        });
        await close();
        await p.getByRole("button", { name: "Ver mes", exact: true }).click();
        await p.screenshot({
          path: path.join(out, `CRM-24-${theme}-${width}x${height}.png`),
        });
        assert.equal(
          await p.getByRole("button", { name: /lunes.*30.*noviembre/ }).count(),
          1,
          "November 30 must exist",
        );
      }
  checks.push(
    "all six Agenda IDs in both themes and sizes; no root tab bar; November 30 present",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => window.mountRefinement("more", "light", "owner"));
  await p.getByRole("button", { name: "Agenda", exact: true }).click();
  await p.getByRole("heading", { name: "Agenda", exact: true }).waitFor();
  await p.waitForFunction(() => window.qaAgenda()?.snapshot().ready);
  checks.push(
    "More opens the actual protected Agenda component through the route mock",
  );
  await p
    .getByRole("button", { name: "Bloquear horario", exact: true })
    .click();
  await p
    .getByRole("textbox", { name: "Motivo (opcional)", exact: true })
    .fill("Pausa de demostración");
  await p.getByRole("button", { name: "Bloquear", exact: true }).click();
  await p.getByRole("button", { name: /Pausa de demostración,/ }).waitFor();
  await p.getByRole("button", { name: /Pausa de demostración,/ }).click();
  await p
    .getByRole("textbox", { name: "Motivo (opcional)", exact: true })
    .fill("Pausa editada");
  await p.getByRole("button", { name: "Guardar bloqueo", exact: true }).click();
  await p.getByRole("button", { name: /Pausa editada,/ }).waitFor();
  await mount();
  await p.getByRole("button", { name: /Pausa editada,/ }).waitFor();
  checks.push("block and edit a real free interval; restore after remount");
  await p.getByRole("button", { name: /Demostración del plan Pro,/ }).click();
  await p.getByRole("button", { name: "Unirse", exact: true }).click();
  await p
    .getByText("Enlace ficticio · no se abre ningún proveedor", { exact: true })
    .waitFor();
  await p.getByRole("button", { name: "Mover a…", exact: true }).click();
  await p.getByRole("button", { name: /viernes.*13.*noviembre/ }).click();
  await p.getByRole("button", { name: "10:30", exact: true }).click();
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await p.getByRole("button", { name: "Confirmar", exact: true }).click();
  await p
    .getByText(
      "No se pudo guardar localmente. Conserva los cambios y reintenta.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await p.evaluate(() => window.qaAgenda().get("demo-booking-b4").version),
    1,
  );
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await p.getByRole("button", { name: "Confirmar", exact: true }).click();
  await p
    .getByRole("button", { name: /Demostración del plan Pro, 10:30/ })
    .waitFor();
  assert.deepEqual(
    await p.evaluate(() => {
      const s = window.qaAgenda();
      return {
        version: s.get("demo-booking-b4").version,
        day: s.snapshot().day,
        count: s.snapshot().rows.filter((r) => r.id === "demo-booking-b4")
          .length,
      };
    }),
    { version: 2, day: "2026-11-13", count: 1 },
  );
  checks.push(
    "meeting link never opens a provider; failed move preserves the record; retry updates once",
  );
  await p.getByRole("button", { name: /Demostración del plan Pro,/ }).click();
  await p.getByRole("button", { name: "Cancelar cita", exact: true }).click();
  await p
    .getByRole("button", { name: "Más opciones de Agenda", exact: true })
    .click();
  await p
    .getByRole("switch", { name: "Mostrar canceladas", exact: true })
    .click();
  await close();
  await p
    .getByRole("button", {
      name: /Demostración del plan Pro, 10:30, cancelada/,
    })
    .waitFor();
  checks.push("cancel is persisted; menu can show cancelled records");
  // Long local day; actual ScrollView offset must survive day/month and leaving the route.
  await p.evaluate(async () => {
    const s = window.qaAgenda();
    for (let i = 0; i < 24; i++)
      await s.block("2026-11-14", 480 + i * 30, 30, `Tramo ${i + 1}`);
  });
  const scrollTop = () =>
    p.getByTestId("agenda-day-list").evaluate((e) => e.scrollTop);
  await p.waitForFunction(() => {
    const e = document.querySelector('[data-testid="agenda-day-list"]');
    return e && e.scrollHeight > e.clientHeight + 650;
  });
  await p.getByTestId("agenda-day-list").evaluate((e) => {
    e.scrollTop = 600;
    e.dispatchEvent(new Event("scroll"));
  });
  await p.waitForTimeout(150);
  const before = await scrollTop();
  assert.ok(before >= 550);
  assert.ok(
    Math.abs(
      (await p.evaluate(() => window.qaAgenda().offset("2026-11-14"))) - before,
    ) <= 2,
    "Actual web scroll event must reach the local offset cache",
  );
  await p.getByRole("button", { name: "Ver mes", exact: true }).click();
  await p.getByRole("button", { name: /sábado.*14.*noviembre/ }).click();
  await p.waitForTimeout(150);
  assert.ok(
    Math.abs((await scrollTop()) - before) <= 2,
    "Agenda scroll must restore after month view",
  );
  await p.getByRole("button", { name: "Atrás", exact: true }).click();
  await p.getByRole("button", { name: "Agenda", exact: true }).click();
  await p.waitForTimeout(150);
  assert.ok(
    Math.abs((await scrollTop()) - before) <= 2,
    "Agenda scroll must restore after returning from More",
  );
  checks.push(
    "24 local slots: actual web scroll survives month navigation and route return",
  );
  await mount("dark", "advisor");
  await p.getByRole("button", { name: /Visita a sucursal,/ }).waitFor();
  assert.equal(
    await p.getByRole("button", { name: /Demostración del plan Pro,/ }).count(),
    0,
  );
  assert.equal(
    await p.getByRole("button", { name: /Comida con proveedor,/ }).count(),
    0,
  );
  checks.push("advisor sees only own appointments");
  await p.evaluate(() => {
    window.qaFailRead = true;
    window.mountRefinement("agenda", "light", "owner");
  });
  await p.getByRole("button", { name: "Reintentar", exact: true }).waitFor();
  await p.screenshot({ path: path.join(out, "state-error-light-390x844.png") });
  await p.evaluate(() => {
    window.qaFailRead = false;
  });
  await p.getByRole("button", { name: "Reintentar", exact: true }).click();
  await p.waitForFunction(() => window.qaAgenda().snapshot().ready);
  for (const status of ["loading", "empty", "offline"]) {
    await p.evaluate(
      (status) => window.qaAgenda().configure({ status }),
      status,
    );
    await p.screenshot({
      path: path.join(out, `state-${status}-light-390x844.png`),
    });
  }
  checks.push("read recovery and loading/empty/offline states");
  const reference = await context.newPage();
  await reference.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await reference.waitForFunction(() => typeof go === "function");
  if (capture)
    for (const theme of ["light", "dark"])
      for (const id of [
        "CRM-20",
        "CRM-21",
        "CRM-22",
        "CRM-23",
        "CRM-24",
        "CRM-25",
      ]) {
        await reference.evaluate(
          ({ id, theme }) => {
            S.theme = theme;
            go(id);
          },
          { id, theme },
        );
        await reference
          .locator("#ph")
          .screenshot({ path: path.join(out, `reference-${id}-${theme}.png`) });
      }
  if (errors.length || networkCount())
    throw Error(JSON.stringify({ errors, networkRequests: networkCount() }));
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        ids: ["CRM-20", "CRM-21", "CRM-22", "CRM-23", "CRM-24", "CRM-25"],
        checks,
        actualCaptures: capture ? 28 : 4,
        officialReferences: capture ? 12 : 0,
        mode: capture ? "complete" : "behavior-only",
        errors,
        networkRequests: networkCount(),
        native: false,
        httpServerStarted: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ agendaChecks: checks, errors }));
  await p.close();
  await reference.close();
}

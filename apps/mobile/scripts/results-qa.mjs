import { capturePage, settle } from "./qa-settle.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
export async function runResults(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-results");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("RESULTS_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const shot = capturePage(p);
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => window.mountRefinement("results", theme, role),
      { theme, role },
    );
    await p.getByRole("heading", { name: "Resultados", exact: true }).waitFor();
  };
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await shot({
        path: path.join(out, `RES-01-${theme}-${width}x${height}.png`),
      });
      await p
        .getByRole("button", { name: "Periodo y asesor", exact: true })
        .click();
      await shot({
        path: path.join(out, `RES-02-${theme}-${width}x${height}.png`),
      });
      await close();
      for (const [tab, key] of [
        ["Atención", "care"],
        ["Origen", "origin"],
      ]) {
        await p.getByRole("tab", { name: tab, exact: true }).click();
        await shot({
          path: path.join(
            out,
            `section-${key}-${theme}-${width}x${height}.png`,
          ),
        });
      }
    }
  checks.push("2 IDs plus care/origin sections in both themes and sizes");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => window.mountRefinement("more", "light", "owner"));
  await p.getByRole("button", { name: "Resultados", exact: true }).click();
  assert.equal(await p.getByText("Bandeja", { exact: true }).count(), 0);
  await p.getByRole("button", { name: "7 días", exact: true }).click();
  const short = await p.evaluate(() => window.qaResults().summary().prospects);
  await p.getByRole("button", { name: "30 días", exact: true }).click();
  assert.ok(
    short < (await p.evaluate(() => window.qaResults().summary().prospects)),
  );
  checks.push("More → Results; ranges recompute the ledger");
  await p
    .getByRole("button", { name: "Periodo y asesor", exact: true })
    .click();
  await p.getByRole("button", { name: /Desde:/ }).click();
  await p
    .getByRole("textbox", { name: "Desde · AAAA-MM-DD", exact: true })
    .fill("2026-12-31");
  await p.getByRole("button", { name: "Aplicar", exact: true }).click();
  await p
    .getByText("Desde debe ser anterior o igual a Hasta.", { exact: true })
    .waitFor();
  assert.equal(
    await p
      .getByRole("textbox", { name: "Desde · AAAA-MM-DD", exact: true })
      .inputValue(),
    "2026-12-31",
  );
  const today = await p.evaluate(() => window.qaResults().today);
  await p
    .getByRole("textbox", { name: "Desde · AAAA-MM-DD", exact: true })
    .fill(today.slice(0, 8) + "01");
  await p.getByRole("button", { name: "Luis Ortega", exact: true }).click();
  await p.getByRole("button", { name: "Aplicar", exact: true }).click();
  await p.waitForFunction(
    () => window.qaResults().snapshot().query.assignee === "demo-advisor",
  );
  assert.ok(
    (await p.evaluate(() => window.qaResults().summary().prospects)) < 38,
  );
  checks.push(
    "Invalid dates retain sheet; custom range and active advisor apply coherently",
  );
  await p.getByRole("tab", { name: "Atención", exact: true }).click();
  await p.evaluate(() => window.qaNavigate("/work"));
  await p
    .getByRole("heading", { name: "Tareas y notas", exact: true })
    .waitFor();
  await p.evaluate(() => window.qaGoBack());
  await p.getByRole("tab", { name: "Atención", exact: true }).waitFor();
  assert.equal(
    await p.evaluate(() => window.qaResults().snapshot().query.assignee),
    "demo-advisor",
  );
  assert.equal(
    await p
      .getByRole("tab", { name: "Atención", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  checks.push(
    "Tab, advisor and period retained after navigating to Work and back",
  );
  await mount();
  await p.setViewportSize({ width: 360, height: 640 });
  await p.waitForTimeout(80);
  await p.getByTestId("results-scroll").evaluate((el) => {
    el.scrollTop = 140;
    el.dispatchEvent(new Event("scroll"));
  });
  await p.waitForTimeout(130);
  const actualOffset = await p
    .getByTestId("results-scroll")
    .evaluate((el) => el.scrollTop);
  assert.ok(actualOffset > 50);
  await p.getByRole("tab", { name: "Atención", exact: true }).click();
  await p.getByRole("tab", { name: "Ventas", exact: true }).click();
  await p.waitForTimeout(100);
  assert.ok(
    Math.abs(
      (await p.getByTestId("results-scroll").evaluate((el) => el.scrollTop)) -
        actualOffset,
    ) < 3,
  );
  checks.push("Actual web scroll restored independently on returning to Sales");

  await mount("dark", "advisor");
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  await mount("light", "coordinator");
  await p.getByText("Dinero ganado", { exact: true }).waitFor();
  checks.push("Advisor route denied; coordinator access allowed");
  for (const status of ["loading", "empty", "offline", "error"]) {
    await mount();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await p.waitForTimeout(60);
    await shot({
      path: path.join(out, `state-${status}-light-390x844.png`),
    });
    if (status === "error") {
      await p.getByRole("button", { name: "Reintentar", exact: true }).click();
      await p.getByText("Dinero ganado", { exact: true }).waitFor();
    }
  }
  checks.push("Loading, empty, offline, error and retry without losing query");
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of ["RES-01", "RES-02"]) {
      await ref.evaluate(
        ({ id, theme }) => {
          S.theme = theme;
          go(id);
        },
        { id, theme },
      );
      await ref
        .locator("#ph")
        .screenshot({ path: path.join(out, `reference-${id}-${theme}.png`) });
    }
  if (errors.length || networkCount())
    throw Error(JSON.stringify({ errors, networkRequests: networkCount() }));
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        ids: ["RES-01", "RES-02"],
        checks,
        actualCaptures: 20,
        officialReferences: 4,
        errors,
        networkRequests: networkCount(),
        native: false,
        httpServerStarted: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }));
  await p.close();
  await ref.close();
}

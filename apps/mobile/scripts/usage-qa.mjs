import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runUsage(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-usage");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  let actualCaptures = 0;
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("USAGE_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => {
        window.qaResetStorage();
        window.qaFailWrite = false;
        window.mountRefinement("usage", theme, role);
      },
      { theme, role },
    );
    if (role === "owner")
      await p
        .getByRole("heading", { name: "Uso y plan", exact: true })
        .waitFor();
    await settle(p);
  };
  const nav = async (route) => {
    await p.evaluate((route) => window.qaNavigate(route), route);
    await settle(p);
  };
  const scenario = async (s) => {
    await p.evaluate((s) => window.qaStudio().usageScenario(s), s);
    await settle(p);
  };
  const shot = async (name, title) => {
    if (title)
      await p.getByRole("heading", { name: title, exact: true }).waitFor();
    await settle(p);
    await p.screenshot({ path: path.join(out, name + ".png") });
    actualCaptures++;
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
      await scenario("warning");
      await nav("/(tabs)/more");
      await shot(`MORE-10-${theme}-${width}x${height}`, "Vas a este ritmo");
      await p
        .getByRole("button", { name: "Recordármelo en 3 días", exact: true })
        .click();
      await nav("/usage");
      await shot(`MORE-06-${theme}-${width}x${height}`, "Uso y plan");
      assert.equal(
        await p
          .getByRole("progressbar", {
            name: "IA del mes: 80 por ciento",
            exact: true,
          })
          .count(),
        1,
      );
      await p
        .getByRole("button", { name: "Mejora tu plan", exact: true })
        .click();
      await shot(`MORE-07-${theme}-${width}x${height}`, "Mejora tu plan");
      await p
        .getByRole("button", { name: "Solicitar Ultra", exact: true })
        .click();
      await shot(`MORE-09-${theme}-${width}x${height}`, "Solicitar plan Ultra");
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(
        await p.evaluate(() => window.qaStudio().usageData().requests.length),
        0,
      );
      await scenario("assistant-blocked");
      await nav("/assistant");
      await p
        .getByText("El asistente alcanzó su tope", { exact: true })
        .waitFor();
      await shot(`AST-04-${theme}-${width}x${height}`, "Asistente");
      assert.equal(
        await p
          .getByRole("textbox", { name: "Pregunta al asistente", exact: true })
          .count(),
        0,
      );
      await p
        .getByRole("button", { name: "Mejora tu plan", exact: true })
        .click();
      await p
        .getByRole("heading", { name: "Mejora tu plan", exact: true })
        .waitFor();
    }
  checks.push(
    "5 IDs captured in both themes and viewport sizes; warning, forecast snooze, catalog, cancel, assistant cap and plan navigation",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await nav("/plans");
  await p.getByRole("button", { name: "Solicitar Ultra", exact: true }).click();
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await p.getByRole("button", { name: "Solicitar", exact: true }).click();
  await p.getByText(/No se pudo guardar/).waitFor();
  await shot("state-save-error-light-390x844", "Solicitar plan Ultra");
  assert.equal(
    await p.evaluate(() => window.qaStudio().usageData().requests.length),
    0,
  );
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await p.getByRole("button", { name: "Solicitar", exact: true }).click();
  await p.getByText("Solicitud local guardada", { exact: true }).waitFor();
  assert.equal(
    await p.evaluate(() => window.qaStudio().usageData().plan),
    "pro",
  );
  await p.getByRole("button", { name: "Solicitar Ultra", exact: true }).click();
  await p.getByRole("button", { name: "Solicitar", exact: true }).click();
  await p.getByText("Solicitud local guardada", { exact: true }).waitFor();
  assert.equal(
    await p.evaluate(() => window.qaStudio().usageData().requests.length),
    1,
  );
  await shot("state-request-saved-light-390x844", "Mejora tu plan");
  checks.push(
    "Save failure preserves dialog and no request; retry and repeated submission save a single local request without changing Pro",
  );
  await nav("/usage");
  await scenario("normal");
  for (const status of ["loading", "empty", "error", "offline"]) {
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await settle(p);
    await shot(`state-${status}-light-390x844`, "Uso y plan");
    if (status === "error") {
      await p.getByRole("button", { name: "Reintentar", exact: true }).click();
      await p
        .getByRole("progressbar", {
          name: "IA del mes: 42 por ciento",
          exact: true,
        })
        .waitFor();
    }
  }
  await p.evaluate(() => window.qaInbox.patch({ status: "normal" }));
  for (const scenarioName of ["organization-blocked", "no-assistant-limit"]) {
    await scenario(scenarioName);
    await nav("/assistant");
    await shot(`state-${scenarioName}-light-390x844`, "Asistente");
    await nav("/usage");
  }
  checks.push(
    "Loading, empty, retry, offline, organization cap and missing assistant cap states",
  );
  for (const role of ["coordinator", "advisor"]) {
    await mount("light", role);
    await p.getByText("Acceso no permitido", { exact: true }).waitFor();
    await nav("/plans");
    await p.getByText("Acceso no permitido", { exact: true }).waitFor();
    await nav("/demo-usage");
    await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  }
  checks.push(
    "Usage, Plans and quota laboratory deny Coordinator and Advisor direct links",
  );
  await mount();
  await nav("/(tabs)/more");
  await p.getByRole("button", { name: /Uso y plan/ }).click();
  await p.getByRole("heading", { name: "Uso y plan", exact: true }).waitFor();
  assert.equal(
    await p.getByRole("tab", { name: "Bandeja", exact: true }).count(),
    0,
  );
  checks.push("More entry opens internal usage screen without bottom tabs");
  const ids = ["MORE-06", "MORE-07", "MORE-09", "MORE-10", "AST-04"],
    ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of ids) {
      await ref.evaluate(
        ({ theme, id }) => {
          S.theme = theme;
          go(id);
        },
        { theme, id },
      );
      await ref
        .locator("#ph")
        .screenshot({ path: path.join(out, `reference-${id}-${theme}.png`) });
    }
  assert.deepEqual(errors, []);
  assert.equal(networkCount(), 0);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        ids,
        checks,
        actualCaptures,
        officialReferences: 10,
        errors,
        networkRequests: networkCount(),
        httpServerStarted: false,
        native: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, actualCaptures, errors }));
  await p.close();
  await ref.close();
}

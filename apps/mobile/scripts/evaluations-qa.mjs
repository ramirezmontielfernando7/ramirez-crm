import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runEvaluations(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-evaluations");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("EVAL_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light") => {
    await p.evaluate((theme) => {
      window.qaResetStorage();
      window.mountRefinement("agents", theme, "owner");
    }, theme);
    await p
      .getByRole("button", {
        name: "Editar agente: Ventas — general",
        exact: true,
      })
      .waitFor();
    await p.evaluate(async () => {
      const s = window.qaStudio(),
        a = s.get("demo-agent-a1");
      await s.updateDraft(a.id, a.revision, { ...a.draft, handoff: "" });
    });
    await p.getByRole("tab", { name: "Pruebas", exact: true }).click();
    await p
      .getByRole("button", { name: "Probar con 5 clientes", exact: true })
      .waitFor();
  };
  const run = async () => {
    await p
      .getByRole("button", { name: "Probar con 5 clientes", exact: true })
      .click();
    await p
      .getByRole("button", {
        name: "Prueba: Pide descuento, Falló",
        exact: true,
      })
      .waitFor();
  };
  const shot = async (name, title) => {
    if (title)
      await p.getByRole("heading", { name: title, exact: true }).waitFor();
    await settle(p);
    await p.screenshot({ path: path.join(out, name + ".png") });
  };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await run();
      await shot(`LAB-30-${theme}-${width}x${height}`);
      await p
        .getByRole("button", {
          name: "Prueba: Pide descuento, Falló",
          exact: true,
        })
        .click();
      await shot(`LAB-31-${theme}-${width}x${height}`, "Pide descuento");
      assert.equal(await p.getByText("Bandeja", { exact: true }).count(), 0);
    }
  checks.push(
    "2 evaluation IDs captured both themes/sizes; deterministic failed case; internal detail has no root tabs",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await run();
  await p
    .getByRole("button", { name: "Prueba: Pide descuento, Falló", exact: true })
    .click();
  const before = await p.evaluate(() =>
    JSON.stringify(window.qaStudio().get("demo-agent-a1").versions),
  );
  await p.getByRole("button", { name: "En el asistente", exact: true }).click();
  await p.getByRole("heading", { name: "Asistente", exact: true }).waitFor();
  await p
    .getByText(/Prometió un descuento sin autorización.*Agente:/)
    .waitFor();
  await p
    .getByRole("textbox", { name: "Pregunta al asistente", exact: true })
    .fill("¿Qué pasó en esta prueba?");
  await p
    .getByRole("button", { name: "Enviar al asistente", exact: true })
    .click();
  await p.getByText(/Sobre «Pide descuento»/).waitFor();
  assert.equal(
    await p.evaluate(() =>
      JSON.stringify(window.qaStudio().get("demo-agent-a1").versions),
    ),
    before,
  );
  await p.getByRole("button", { name: "Atrás", exact: true }).click();
  await p
    .getByRole("heading", { name: "Pide descuento", exact: true })
    .waitFor();
  checks.push(
    "Assistant route preserves evaluation context; deterministic follow-up; return preserves original detail",
  );
  await p.evaluate(() => (window.qaFailWrite = true));
  await p
    .getByRole("button", { name: "Proponer arreglo", exact: true })
    .click();
  await p
    .getByText("No se pudo guardar localmente. Tu borrador sigue disponible.", {
      exact: true,
    })
    .last()
    .waitFor();
  await shot("state-fix-error-light-390x844", "Pide descuento");
  await p.evaluate(() => (window.qaFailWrite = false));
  await p
    .getByRole("button", { name: "Proponer arreglo", exact: true })
    .click();
  await p
    .getByRole("button", {
      name: "Arreglo guardado en el borrador",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await p.evaluate(() =>
      JSON.stringify(window.qaStudio().get("demo-agent-a1").versions),
    ),
    before,
  );
  await p.getByRole("button", { name: "Repetir", exact: true }).click();
  await p.getByText("Bien", { exact: true }).waitFor();
  await p.waitForFunction(
    () => window.qaStudio().doc().runs[0].results[2].attempts.length === 2,
  );
  checks.push(
    "Failed fix retains state; safe retry writes only draft; repeat improves grade while retaining failed original attempt",
  );
  await mount();
  await p.getByRole("button", { name: /Qué versión se prueba:/ }).click();
  await p
    .getByRole("radio", {
      name: "Publicada de «Ventas — general»",
      exact: true,
    })
    .click();
  await p.getByRole("button", { name: "3", exact: true }).click();
  await p
    .getByRole("button", { name: "Probar con 3 clientes", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Prueba: Pide descuento, Bien", exact: true })
    .waitFor();
  assert.equal(
    await p.evaluate(() => window.qaStudio().doc().runs[0].source),
    "published",
  );
  assert.equal(
    await p.evaluate(() => window.qaStudio().doc().runs[0].results.length),
    3,
  );
  checks.push(
    "Version selector and 3/5/8 clients bind results to saved configuration snapshot",
  );
  for (const status of ["loading", "empty", "offline", "error"]) {
    await mount();
    if (status !== "empty") await run();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await shot(`state-${status}-light-390x844`);
    if (status === "error") {
      await p.getByRole("button", { name: "Reintentar", exact: true }).click();
      await p
        .getByRole("button", {
          name: "Prueba: Pide descuento, Falló",
          exact: true,
        })
        .waitFor();
    }
  }
  const ids = ["LAB-30", "LAB-31"],
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
  if (errors.length || networkCount())
    throw Error(JSON.stringify({ errors, requests: networkCount() }));
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        ids,
        checks,
        actualCaptures: 13,
        officialReferences: 4,
        errors,
        networkRequests: networkCount(),
        httpServerStarted: false,
        native: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }));
  await p.close();
  await ref.close();
}

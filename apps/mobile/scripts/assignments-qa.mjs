import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runAssignments(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-assignments");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("ASSIGN_ERROR", e.message);
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
    await p.getByRole("tab", { name: "Asignación", exact: true }).click();
    await p
      .getByRole("button", { name: "Etapa Nuevo: Citas y agenda", exact: true })
      .waitFor();
  };
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
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
      await shot(`LAB-20-${theme}-${width}x${height}`);
      await p
        .getByRole("button", {
          name: "Etapa Nuevo: Citas y agenda",
          exact: true,
        })
        .click();
      await shot(`LAB-21-${theme}-${width}x${height}`, "Etapa «Nuevo»");
      assert.equal(
        await p
          .getByRole("radio", { name: "Soporte posventa", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await p
          .getByRole("radio", { name: "Ventas — general", exact: true })
          .count(),
        0,
      );
      await close();
    }
  checks.push(
    "2 assignment IDs captured both themes/sizes; draft/general excluded from eligible choices",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await p
    .getByRole("button", { name: "Etapa Nuevo: Citas y agenda", exact: true })
    .click();
  await p.getByRole("radio", { name: "Agente general", exact: true }).click();
  await shot("state-replace-light-390x844", "Etapa «Nuevo»");
  await p.getByRole("button", { name: "Cancelar cambio", exact: true }).click();
  assert.equal(
    await p.evaluate(() => window.qaStudio().doc().assignments["demo-stage-1"]),
    "demo-agent-a2",
  );
  await p.getByRole("radio", { name: "Agente general", exact: true }).click();
  await p.evaluate(() => (window.qaFailWrite = true));
  await p
    .getByRole("button", { name: "Confirmar reemplazo", exact: true })
    .click();
  await p
    .getByText("No se pudo guardar localmente. Tu borrador sigue disponible.", {
      exact: true,
    })
    .last()
    .waitFor();
  await shot("state-save-error-light-390x844", "Etapa «Nuevo»");
  assert.equal(
    await p.evaluate(() => window.qaStudio().doc().assignments["demo-stage-1"]),
    "demo-agent-a2",
  );
  await p.evaluate(() => (window.qaFailWrite = false));
  await p
    .getByRole("button", { name: "Confirmar reemplazo", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Etapa Nuevo: Agente general", exact: true })
    .waitFor();
  checks.push(
    "Replacement confirm/cancel; failed save retains previous binding and retry works",
  );
  await p.evaluate(() => window.qaNavigate("/(tabs)/crm"));
  await p.getByRole("heading", { name: "CRM", exact: true }).waitFor();
  await p.evaluate(() => {
    window.qaModel().addStage("Cotizado QA");
    window.qaModel().color("Cotizado QA", "#8b5cf6");
  });
  await p.evaluate(() => window.qaNavigate("/(tabs)/studio"));
  await p
    .getByRole("button", {
      name: "Etapa Cotizado QA: Agente general",
      exact: true,
    })
    .waitFor();
  const key = await p.evaluate(() =>
    window.qaInbox.repository.stageIdentity("Cotizado QA"),
  );
  await p
    .getByRole("button", {
      name: "Etapa Cotizado QA: Agente general",
      exact: true,
    })
    .click();
  await p.getByRole("radio", { name: "Citas y agenda", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Etapa Cotizado QA: Citas y agenda",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await p.evaluate(
      () =>
        window
          .qaStudio()
          .stageRows()
          .find((s) => s.name === "Cotizado QA").color,
    ),
    "#8b5cf6",
  );
  checks.push(
    "Actual Pipeline model additions/colors appear in Studio; assignment uses same catalog identity",
  );
  await p.evaluate(() => {
    window.qaModel().deleteStage("Cotizado QA", "Nuevo");
    window.qaModel().addStage("Cotizado QA");
  });
  await p
    .getByRole("button", {
      name: "Etapa Cotizado QA: Agente general",
      exact: true,
    })
    .waitFor();
  assert.notEqual(
    await p.evaluate(() =>
      window.qaInbox.repository.stageIdentity("Cotizado QA"),
    ),
    key,
  );
  checks.push("Delete/recreate same-name stage never reuses old agent binding");
  for (const status of ["loading", "empty", "offline", "error"]) {
    await mount();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await shot(`state-${status}-light-390x844`);
    if (status === "error") {
      await p.getByRole("button", { name: "Reintentar", exact: true }).click();
      await p
        .getByRole("button", {
          name: "Etapa Nuevo: Citas y agenda",
          exact: true,
        })
        .waitFor();
    }
  }
  const ids = ["LAB-20", "LAB-21"],
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
        actualCaptures: 14,
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

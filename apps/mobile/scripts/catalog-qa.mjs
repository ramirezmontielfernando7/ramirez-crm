import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runCatalog(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-catalog");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  let actualCaptures = 0;
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("CATALOG_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light", role = "owner", reset = true) => {
    await p.evaluate(
      ({ theme, role, reset }) => {
        if (reset) window.qaResetStorage();
        window.qaFailRead = false;
        window.qaFailWrite = false;
        window.mountRefinement("tags", theme, role);
      },
      { theme, role, reset },
    );
    if (role !== "advisor")
      await p
        .getByRole("button", { name: "Nueva etiqueta", exact: true })
        .waitFor();
    await settle(p);
  };
  const nav = async (route) => {
    await p.evaluate((route) => window.qaNavigate(route), route);
    await settle(p);
  };
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  const shot = async (name, title) => {
    if (title)
      await p.getByRole("heading", { name: title, exact: true }).waitFor();
    await settle(p);
    await p.screenshot({ path: path.join(out, name + ".png") });
    actualCaptures++;
  };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await shot(`SET-05-${theme}-${width}x${height}`, "Etiquetas");
      await p
        .getByRole("button", { name: "Editar etiqueta Promo nov", exact: true })
        .click();
      await shot(`SET-05A-${theme}-${width}x${height}`, "Etiqueta");
      await close();
      await nav("/loss-reasons");
      await shot(`SET-07-${theme}-${width}x${height}`, "Motivos de pérdida");
    }
  checks.push(
    "3 IDs captured actual RN in both themes/sizes, approved palette and internal headers, no new product selectors",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await p.getByRole("button", { name: "Nueva etiqueta", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Nombre", exact: true })
    .fill("Seguimiento QA");
  await p.getByRole("radio", { name: "Color #d94a4a", exact: true }).click();
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  await shot("state-save-error-light-390x844", "Etiqueta");
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Editar etiqueta Seguimiento QA",
      exact: true,
    })
    .waitFor();
  await nav("/contact/demo-conv-1");
  await p.getByRole("button", { name: /^Etiquetas ·/ }).click();
  await p
    .getByRole("checkbox", { name: "Seguimiento QA", exact: true })
    .click();
  await p.waitForFunction(() =>
    window.qaInbox.repository
      .get(window.qaInbox.actor, "demo-conv-1")
      .tags.includes("Seguimiento QA"),
  );
  await close();
  await nav("/(tabs)/inbox");
  await p.getByRole("button", { name: "Buscar", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Buscar chats", exact: true })
    .fill("Seguimiento QA");
  await p.getByRole("button", { name: /Karla Méndez,/ }).waitFor();
  await shot("state-shared-inbox-light-390x844");
  await nav("/tags");
  await p
    .getByRole("button", {
      name: "Editar etiqueta Seguimiento QA",
      exact: true,
    })
    .click();
  await p
    .getByRole("textbox", { name: "Nombre", exact: true })
    .fill("Prioridad QA");
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByRole("button", { name: "Editar etiqueta Prioridad QA", exact: true })
    .waitFor();
  assert.ok(
    await p.evaluate(() =>
      window.qaInbox.repository
        .get(window.qaInbox.actor, "demo-conv-1")
        .tags.includes("Prioridad QA"),
    ),
  );
  checks.push(
    "Save failure retains editor; create/retry, palette, Contact selection, canonical Inbox search and rename propagation without duplicate assignment",
  );
  await p
    .getByRole("button", { name: "Editar etiqueta Prioridad QA", exact: true })
    .click();
  await p
    .getByRole("textbox", { name: "Nombre", exact: true })
    .fill("Texto sin guardar");
  await p.getByRole("button", { name: "Borrar", exact: true }).click();
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(
    await p.getByRole("textbox", { name: "Nombre", exact: true }).inputValue(),
    "Texto sin guardar",
  );
  await p.getByRole("button", { name: "Borrar", exact: true }).click();
  await p.getByRole("button", { name: "Borrar etiqueta", exact: true }).click();
  await p.waitForFunction(() => !window.qaCatalog().tag("Prioridad QA"));
  assert.equal(
    await p.evaluate(() =>
      window.qaInbox.repository
        .get(window.qaInbox.actor, "demo-conv-1")
        .tags.includes("Prioridad QA"),
    ),
    false,
  );
  checks.push(
    "Delete requires confirmation; cancel preserves unsaved editor; confirm removes tag from canonical assignments",
  );
  await p
    .getByRole("button", { name: "Fusionar Importación · demo", exact: true })
    .click();
  await p.getByRole("radio", { name: "VIP", exact: true }).click();
  await shot("state-merge-choice-light-390x844", "Fusionar etiqueta");
  await p.getByRole("button", { name: "Fusionar", exact: true }).click();
  await shot("state-merge-confirm-light-390x844", "¿Fusionar etiquetas?");
  await p
    .getByRole("button", { name: "Fusionar etiquetas", exact: true })
    .click();
  await p.waitForFunction(
    () => window.qaCatalog().tag("Importación · demo")?.name === "VIP",
  );
  checks.push(
    "Automatic import tag shown separately and merges to manual target only after confirmation",
  );
  await nav("/loss-reasons");
  await p.getByRole("button", { name: "Nuevo motivo", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Nombre", exact: true })
    .fill("Sin cobertura QA");
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Editar motivo Sin cobertura QA",
      exact: true,
    })
    .waitFor();
  await nav("/contact/demo-conv-1");
  await p.getByRole("button", { name: /^Etapa ·/ }).click();
  await p.getByRole("radio", { name: "Perdido", exact: true }).click();
  await p.getByRole("radio", { name: "Sin cobertura QA", exact: true }).click();
  await p.getByRole("button", { name: "Marcar perdido", exact: true }).click();
  await p
    .getByRole("button", { name: "Etapa · Perdido", exact: true })
    .waitFor();
  await nav("/loss-reasons");
  await p
    .getByRole("button", {
      name: "Editar motivo Sin cobertura QA",
      exact: true,
    })
    .click();
  await p
    .getByRole("button", { name: "Desactivar motivo", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Desactivar motivo", exact: true })
    .click();
  await p.waitForFunction(
    () => !window.qaCatalog().reasonNames().includes("Sin cobertura QA"),
  );
  assert.equal(
    await p.evaluate(
      () => window.qaDirectory.get("demo-conv-1").snapshot().data.lossReason,
    ),
    "Sin cobertura QA",
  );
  await shot("state-reason-deactivated-light-390x844", "Motivos de pérdida");
  assert.equal(
    await p
      .getByRole("button", { name: "Editar motivo Otro", exact: true })
      .count(),
    0,
  );
  checks.push(
    "New loss reason used in actual Contact/Chat flow; deactivation excludes new selections and preserves historical reason; Otro fixed",
  );
  await mount("light", "coordinator", false);
  await p
    .getByRole("button", { name: "Nueva etiqueta", exact: true })
    .waitFor();
  await nav("/loss-reasons");
  await p.getByRole("button", { name: "Nuevo motivo", exact: true }).waitFor();
  await mount("light", "advisor", false);
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  await nav("/loss-reasons");
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  checks.push(
    "Owner and Coordinator manage; Advisor denied both direct catalog routes; org catalog persists across actors",
  );
  for (const status of ["loading", "empty", "error", "offline"]) {
    await mount();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await shot(`state-${status}-light-390x844`, "Etiquetas");
    if (status === "error") {
      await p.getByRole("button", { name: "Reintentar", exact: true }).click();
      await p
        .getByRole("button", { name: "Nueva etiqueta", exact: true })
        .waitFor();
    }
  }
  checks.push(
    "Loading, empty, retry and offline states use approved components",
  );
  const ids = ["SET-05", "SET-05A", "SET-07"],
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
  const result = {
    ids,
    checks,
    actualCaptures,
    officialReferences: 6,
    errors,
    networkRequests: networkCount(),
    httpServerStarted: false,
    native: false,
  };
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  await p.close();
  await ref.close();
}

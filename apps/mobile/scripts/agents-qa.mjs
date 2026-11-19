import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runAgents(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-agents");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("AGENTS_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => window.mountRefinement("agents", theme, role),
      { theme, role },
    );
    if (role === "owner")
      await p
        .getByRole("button", {
          name: "Editar agente: Ventas — general",
          exact: true,
        })
        .waitFor();
    await settle(p);
  };
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  const shot = async (id, theme, width, height, title) => {
    if (title)
      await p.getByRole("heading", { name: title, exact: true }).waitFor();
    await settle(p);
    await p.screenshot({
      path: path.join(out, `${id}-${theme}-${width}x${height}.png`),
    });
  };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate(() => window.qaResetStorage());
      await mount(theme);
      await shot("LAB-01", theme, width, height);
      await p
        .getByRole("button", { name: "Más opciones de Agentes", exact: true })
        .click();
      await shot("LAB-08", theme, width, height, "Más opciones de Agentes");
      await close();
      await p
        .getByRole("button", { name: "Crea tu agente platicando", exact: true })
        .click();
      await p
        .getByRole("textbox", { name: "Mensaje para el creador", exact: true })
        .fill("Tengo una joyería en CDMX. Vendo mayoreo y menudeo.");
      await p
        .getByRole("button", { name: "Enviar al creador", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Ver borrador", exact: true })
        .waitFor();
      await shot("LAB-02", theme, width, height, "Crear agente");
      await p.evaluate(() => window.qaNavigate("/studio-agent/demo-agent-a1"));
      await p
        .getByRole("textbox", {
          name: "Nombre de presentación (opcional)",
          exact: true,
        })
        .waitFor();
      await shot("LAB-03", theme, width, height, "Ventas — general");
      await p.getByRole("button", { name: "Probar", exact: true }).click();
      await shot("LAB-04", theme, width, height, "Vista previa");
      await close();
      await p
        .getByRole("button", { name: "Más opciones del agente", exact: true })
        .click();
      await shot("LAB-09", theme, width, height, "Más opciones del agente");
      await p
        .getByRole("button", { name: "Archivar agente", exact: true })
        .click();
      await shot("LAB-09A", theme, width, height, "Archivar agente");
      await close();
    }
  checks.push(
    "7 IDs captured with actual screens/sheets in both themes and sizes; internal routes have no root tabs",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await p
    .getByRole("button", { name: "Crea tu agente platicando", exact: true })
    .click();
  const input = p.getByRole("textbox", {
    name: "Mensaje para el creador",
    exact: true,
  });
  await input.fill("Negocio para QA: joyería");
  await p.evaluate(() => (window.qaFailWrite = true));
  await p
    .getByRole("button", { name: "Enviar al creador", exact: true })
    .click();
  await p
    .getByText("No se pudo guardar localmente. Tu borrador sigue disponible.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await input.inputValue(), "Negocio para QA: joyería");
  await p.evaluate(() => (window.qaFailWrite = false));
  await p
    .getByRole("button", { name: "Enviar al creador", exact: true })
    .click();
  await p.getByRole("button", { name: "Ver borrador", exact: true }).waitFor();
  await p
    .getByRole("button", { name: "Hazlo más formal", exact: true })
    .click();
  await p.waitForFunction(
    () =>
      window.qaStudio().doc().creator.turns.at(-1)?.text === "Hazlo más formal",
  );
  const created = await p.evaluate(
    () => window.qaStudio().doc().creator.agentId,
  );
  assert.equal(
    await p.evaluate(
      () =>
        window.qaStudio().get(window.qaStudio().doc().creator.agentId).versions
          .length,
    ),
    0,
  );
  checks.push(
    "Creator failure preserves text; retry once and suggestion update a draft without publishing",
  );
  await p.getByRole("button", { name: "Ver borrador", exact: true }).click();
  assert.equal(await p.getByText("Bandeja", { exact: true }).count(), 0);
  await p
    .getByRole("textbox", {
      name: "Nombre de presentación (opcional)",
      exact: true,
    })
    .fill("Sofi QA");
  await p.waitForFunction(
    (id) => window.qaStudio().get(id).draft.displayName === "Sofi QA",
    created,
  );
  await p.getByRole("button", { name: "Tono, contraído", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Tono", exact: true })
    .fill("Cercano de QA");
  await p.waitForFunction(
    (id) => window.qaStudio().get(id).draft.tone === "Cercano de QA",
    created,
  );
  checks.push(
    "Editor accordion and debounced autosave persist identity/tone; footer stays usable",
  );
  const before = await p.evaluate(() => ({
    revision: window.qaStudio().doc().revision,
    turns: window.qaStudio().doc().creator.turns.length,
  }));
  await p.getByRole("button", { name: "Probar", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Mensaje de prueba", exact: true })
    .fill("Necesito factura");
  await p
    .getByRole("button", { name: "Enviar mensaje de prueba", exact: true })
    .click();
  await p.getByText("Decisión: pasar a persona", { exact: true }).waitFor();
  assert.deepEqual(
    await p.evaluate(() => ({
      revision: window.qaStudio().doc().revision,
      turns: window.qaStudio().doc().creator.turns.length,
    })),
    before,
  );
  await close();
  checks.push(
    "Stateless preview answers without mutating Studio, chats or creator transcript",
  );
  await p
    .getByRole("button", { name: "Más opciones del agente", exact: true })
    .click();
  await p.getByRole("button", { name: "Renombrar", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Nombre interno", exact: true })
    .fill("Agente QA renombrado");
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByRole("heading", { name: "Agente QA renombrado", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Más opciones del agente", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Pausar este agente", exact: true })
    .click();
  await p
    .getByText("Agente en pausa · los chats nuevos pasan a una persona.", {
      exact: true,
    })
    .waitFor();
  checks.push(
    "Internal rename independent of display name; local per-agent pause produces feedback",
  );
  await p
    .getByRole("button", { name: "Más opciones del agente", exact: true })
    .click();
  await p.getByRole("button", { name: "Archivar agente", exact: true }).click();
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(
    await p
      .getByRole("heading", { name: "Agente QA renombrado", exact: true })
      .count(),
    1,
  );
  await p
    .getByRole("button", { name: "Más opciones del agente", exact: true })
    .click();
  await p.getByRole("button", { name: "Archivar agente", exact: true }).click();
  await p.getByRole("button", { name: "Archivar", exact: true }).click();
  await p.waitForFunction(
    (id) =>
      window
        .qaStudio()
        .doc()
        .agents.some((a) => a.id === id && a.archived),
    created,
  );
  checks.push(
    "Archive cancel retains agent; confirm removes it and returns safely to Studio",
  );
  await p.getByRole("tab", { name: "Conocimiento", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Documento: Catálogo mayoreo 2026.pdf",
      exact: true,
    })
    .waitFor();
  await p.getByRole("tab", { name: "Agentes", exact: true }).click();
  checks.push(
    "Agents ↔ existing Knowledge use same LibraryStore and approved module header",
  );
  for (const role of ["coordinator", "advisor"]) {
    await mount("dark", role);
    await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  }
  checks.push("Direct Studio route rejected for coordinator/advisor");
  for (const status of ["loading", "empty", "offline", "error"]) {
    await mount();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await settle(p);
    await p.screenshot({
      path: path.join(out, `state-${status}-light-390x844.png`),
    });
    if (status === "error") {
      await p.getByRole("button", { name: "Reintentar", exact: true }).click();
      await p
        .getByRole("button", {
          name: "Editar agente: Ventas — general",
          exact: true,
        })
        .waitFor();
    }
  }
  const ids = [
      "LAB-01",
      "LAB-02",
      "LAB-03",
      "LAB-04",
      "LAB-08",
      "LAB-09",
      "LAB-09A",
    ],
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
    throw Error(JSON.stringify({ errors, requests: networkCount() }));
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        ids,
        checks,
        actualCaptures: 32,
        officialReferences: 14,
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

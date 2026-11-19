import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
/** Called by the existing offline component/provider harness, never a network server. */
export async function runLibrary(context, html, root, networkCount = () => 0) {
  const out = path.join(root, "artifacts/continuation-library");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("LIBRARY_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => window.mountRefinement("crm", theme, role),
      { theme, role },
    );
    await p.getByRole("tab", { name: "Biblioteca", exact: true }).click();
    await p
      .getByRole("textbox", { name: "Buscar por título o contenido" })
      .waitFor();
    await p.waitForFunction(() => window.qaLibrary()?.snapshot().ready);
  };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await p.screenshot({
        path: path.join(out, `CRM-40-${theme}-${width}x${height}.png`),
      });
      await p
        .getByRole("button", { name: "Catálogo mayoreo 2026.pdf", exact: true })
        .click();
      await p.screenshot({
        path: path.join(out, `CRM-41-${theme}-${width}x${height}.png`),
      });
      await p.getByRole("button", { name: "Atrás", exact: true }).click();
      await p
        .getByRole("button", { name: "Más opciones de Biblioteca" })
        .click();
      await p
        .getByRole("heading", { name: "Biblioteca", exact: true })
        .waitFor();
      await p.screenshot({
        path: path.join(out, `CRM-42-${theme}-${width}x${height}.png`),
      });
      await p.getByRole("button", { name: "Cerrar", exact: true }).click();
      for (const [screen, tab] of [
        ["crm", "Pipeline"],
        ["contacts", "Contactos"],
      ]) {
        await p.getByRole("tab", { name: tab, exact: true }).click();
        await p.waitForTimeout(100);
        await p.screenshot({
          path: path.join(
            out,
            `regression-${screen}-${theme}-${width}x${height}.png`,
          ),
        });
        await p.getByRole("tab", { name: "Biblioteca", exact: true }).click();
      }
    }
  checks.push(
    "CRM-40/41/42 in both themes and sizes; Pipeline and Contacts navigation retained",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await p
    .getByRole("textbox", { name: "Buscar por título o contenido" })
    .fill("politica");
  assert.equal(
    await p
      .getByRole("button", { name: "Política de envíos", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await p
      .getByRole("button", { name: "Catálogo mayoreo 2026.pdf", exact: true })
      .count(),
    0,
  );
  await p
    .getByRole("textbox", { name: "Buscar por título o contenido" })
    .fill("");
  await p.getByRole("button", { name: "Agregar a la Biblioteca" }).click();
  await p
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Nueva política demo");
  await p
    .getByRole("textbox", { name: "Contenido", exact: true })
    .fill("Contenido ficticio para probar almacenamiento.");
  await p
    .getByRole("switch", { name: "💬 Envío en chat", exact: true })
    .click();
  await p
    .getByRole("switch", { name: "🤖 Lectura IA (RAG)", exact: true })
    .click();
  assert.ok(
    await p.getByRole("button", { name: "Guardar", exact: true }).isDisabled(),
  );
  await p
    .getByRole("switch", { name: "💬 Envío en chat", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Agregar archivo (opcional)", exact: true })
    .click();
  await p.getByRole("button", { name: "Muestra PDF", exact: true }).click();
  assert.equal(await p.locator('input[type="file"]').count(), 0);
  await p
    .getByRole("textbox", { name: "Etiquetas (opcional)", exact: true })
    .fill("demo, envíos");
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByText("No se pudo guardar localmente. Tu borrador sigue disponible.", {
      exact: true,
    })
    .first()
    .waitFor();
  assert.equal(
    await p.getByRole("textbox", { name: "Título", exact: true }).inputValue(),
    "Nueva política demo",
  );
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByRole("button", { name: "Nueva política demo", exact: true })
    .waitFor();
  await mount();
  await p
    .getByRole("button", { name: "Nueva política demo", exact: true })
    .waitFor();
  checks.push(
    "search, destinations, sample attachment, failed save retry, restore after provider remount",
  );
  await p
    .getByRole("button", { name: "Nueva política demo", exact: true })
    .click();
  await p
    .getByRole("textbox", { name: "Contenido", exact: true })
    .fill("Cambio pendiente");
  await p.getByRole("button", { name: "Atrás", exact: true }).click();
  await p.getByRole("button", { name: "Seguir editando", exact: true }).click();
  assert.equal(
    await p
      .getByRole("textbox", { name: "Contenido", exact: true })
      .inputValue(),
    "Cambio pendiente",
  );
  await p.getByRole("button", { name: "Atrás", exact: true }).click();
  await p.getByRole("button", { name: "Descartar", exact: true }).click();
  await p.getByRole("button", { name: "Más opciones de Biblioteca" }).click();
  await p.getByRole("button", { name: "Nueva carpeta", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Nombre de carpeta", exact: true })
    .fill("Cursos demo");
  await p.getByRole("button", { name: "Crear carpeta", exact: true }).click();
  await p.getByRole("button", { name: "Cursos demo", exact: true }).waitFor();
  checks.push(
    "dirty back confirmation, cancel discard and local folder creation",
  );
  await p.getByRole("button", { name: "Más opciones de Biblioteca" }).click();
  await p
    .getByRole("button", { name: "Filtrar por etiqueta", exact: true })
    .click();
  await p.getByRole("button", { name: "demo", exact: true }).click();
  assert.equal(
    await p
      .getByRole("button", { name: "Catálogo mayoreo 2026.pdf", exact: true })
      .count(),
    0,
  );
  await p
    .getByRole("button", { name: "Quitar etiqueta: demo", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Nueva política demo", exact: true })
    .click();
  await p.getByRole("button", { name: "Borrar entrada", exact: true }).click();
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  await p.getByRole("button", { name: "Borrar entrada", exact: true }).click();
  await p.getByRole("button", { name: "Borrar", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Buscar por título o contenido" })
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Nueva política demo", exact: true })
      .count(),
    0,
  );
  checks.push("tag filter, delete cancellation and confirmed local deletion");
  await mount("light", "advisor");
  assert.equal(
    await p
      .getByRole("button", { name: "Preguntas frecuentes", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await p.getByRole("button", { name: "Agregar a la Biblioteca" }).count(),
    0,
  );
  await p
    .getByRole("button", { name: "Catálogo mayoreo 2026.pdf", exact: true })
    .click();
  assert.equal(
    await p.getByRole("button", { name: "Guardar", exact: true }).count(),
    0,
  );
  checks.push("advisor sees only chat-eligible entries and cannot edit");
  await p.evaluate(() => {
    window.qaFailRead = true;
    window.mountRefinement("crm", "light", "owner");
  });
  await p.getByRole("tab", { name: "Biblioteca", exact: true }).click();
  await p.getByRole("button", { name: "Reintentar", exact: true }).waitFor();
  await p.screenshot({
    path: path.join(out, "state-read-error-light-390x844.png"),
  });
  await p.evaluate(() => {
    window.qaFailRead = false;
  });
  await p.getByRole("button", { name: "Reintentar", exact: true }).click();
  await p
    .getByRole("button", { name: "Catálogo mayoreo 2026.pdf", exact: true })
    .waitFor();
  for (const state of ["loading", "empty", "offline"]) {
    await p.evaluate(
      (state) => window.qaLibrary().configure({ status: state }),
      state,
    );
    await p.screenshot({
      path: path.join(out, `state-${state}-light-390x844.png`),
    });
  }
  checks.push("read failure recovery, loading/empty/offline states");
  // Official screenshots retain their original approved design; B applies to module header/control sizes only.
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of ["CRM-40", "CRM-41", "CRM-42"]) {
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
    throw Error(JSON.stringify({ errors, networkRequests: networkCount() }));
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        ids: ["CRM-40", "CRM-41", "CRM-42"],
        checks,
        actualCaptures: 24,
        officialReferences: 6,
        errors,
        networkRequests: networkCount(),
        native: false,
        networkServerStarted: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ libraryChecks: checks, errors }));
  await p.close();
  await ref.close();
}

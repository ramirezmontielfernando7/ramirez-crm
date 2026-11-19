import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
export async function runWork(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-work");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("WORK_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => window.mountRefinement("work", theme, role),
      { theme, role },
    );
    await p.waitForFunction(() => window.qaWork().snapshot().doc.seeded);
  };
  const notes = () =>
    p.getByRole("tab", { name: "Notas", exact: true }).click();
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await p.screenshot({
        path: path.join(out, `CRM-30-${theme}-${width}x${height}.png`),
      });
      await p
        .getByRole("button", {
          name: "Detalle: Mandar cotización a Karla Méndez",
          exact: true,
        })
        .click();
      await p.screenshot({
        path: path.join(out, `CRM-31-${theme}-${width}x${height}.png`),
      });
      await close();
      await notes();
      await p.screenshot({
        path: path.join(out, `CRM-32-${theme}-${width}x${height}.png`),
      });
      await p
        .getByRole("button", { name: "Precios mayoreo", exact: true })
        .click();
      await p.screenshot({
        path: path.join(out, `CRM-33-${theme}-${width}x${height}.png`),
      });
      await close();
    }
  checks.push(
    "4 IDs captured in both themes and sizes with real RN components",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => window.mountRefinement("more", "light", "owner"));
  await p.getByRole("button", { name: "Tareas y notas", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Agregar tarea", exact: true })
    .waitFor();
  assert.equal(await p.getByText("Bandeja", { exact: true }).count(), 0);
  checks.push("More → Work route; internal screen without root tabs");
  await p
    .getByRole("textbox", { name: "Agregar tarea", exact: true })
    .fill("Tarea QA compartida");
  await p
    .getByRole("textbox", { name: "Agregar tarea", exact: true })
    .press("Enter");
  await p
    .getByRole("button", { name: "Detalle: Tarea QA compartida", exact: true })
    .click();
  await p
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Tarea QA editada");
  await p.getByRole("button", { name: /Contacto: Sin contacto/ }).click();
  await p
    .getByRole("textbox", { name: "Buscar contacto ligado", exact: true })
    .fill("Karla");
  await p.getByRole("button", { name: "Karla Méndez", exact: true }).click();
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByRole("checkbox", {
      name: "Marcar tarea: Tarea QA editada",
      exact: true,
    })
    .click();
  await p.waitForFunction(() =>
    window.qaDirectory
      .get("demo-conv-1")
      .snapshot()
      .data.tasks.some((t) => t.title === "Tarea QA editada" && t.done),
  );
  checks.push(
    "Enter creates; editor links existing contact; checkbox updates contact projection",
  );
  await notes();
  await p.getByRole("button", { name: "Nueva nota", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Título (opcional)", exact: true })
    .fill("Nota QA compartida");
  await p
    .getByRole("textbox", { name: "Escribe una nota…", exact: true })
    .fill("Solo el equipo ficticio");
  await p.getByRole("radio", { name: "Azul", exact: true }).click();
  await p.getByRole("switch", { name: "Fijar arriba", exact: true }).click();
  await p.getByRole("button", { name: /Chat ligado: Ninguno/ }).click();
  await p
    .getByRole("textbox", { name: "Buscar contacto ligado", exact: true })
    .fill("Karla");
  await p.getByRole("button", { name: "Karla Méndez", exact: true }).click();
  await p.evaluate(() => (window.qaFailWrite = true));
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  assert.equal(
    await p
      .getByRole("textbox", { name: "Escribe una nota…", exact: true })
      .inputValue(),
    "Solo el equipo ficticio",
  );
  await p.evaluate(() => (window.qaFailWrite = false));
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByRole("button", { name: "Nota QA compartida", exact: true })
    .waitFor();
  await p.waitForFunction(() =>
    window.qaDirectory
      .get("demo-conv-1")
      .snapshot()
      .data.events.some(
        (e) => e.kind === "Nota" && e.text === "Solo el equipo ficticio",
      ),
  );
  checks.push(
    "Note color/pin/link; failed save retains draft; safe retry projects internal history",
  );
  await p
    .getByRole("button", { name: "Nota QA compartida", exact: true })
    .click();
  await p.getByRole("button", { name: "Borrar", exact: true }).click();
  await p
    .getByRole("button", { name: "Confirmar borrado", exact: true })
    .click();
  await p.waitForFunction(
    () =>
      !window
        .qaWork()
        .notes()
        .some((n) => n.title === "Nota QA compartida"),
  );
  checks.push("Note deletion confirmed and canonical");
  await p.evaluate(() => window.qaNavigate("/agenda"));
  await p.getByRole("button", { name: /Demostración del plan Pro,/ }).click();
  await p
    .getByRole("button", { name: "Abrir contacto: Karla Méndez", exact: true })
    .click();
  await p.getByRole("heading", { name: "Detalles", exact: true }).waitFor();
  checks.push(
    "Agenda → authorized canonical contact without independent task copies",
  );
  await p
    .getByRole("button", { name: "Nueva tarea para este chat", exact: true })
    .click();
  await p
    .getByRole("textbox", { name: "¿Qué hay que hacer?", exact: true })
    .fill("Desde ficha QA");
  await p.getByRole("button", { name: "Crear tarea", exact: true }).click();
  await p.evaluate(() => window.qaNavigate("/work"));
  await p.getByRole("tab", { name: "Tareas", exact: true }).click();
  await p
    .getByRole("button", { name: "Detalle: Desde ficha QA", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Detalle: Desde ficha QA", exact: true })
    .click();
  await p.getByRole("button", { name: "Borrar", exact: true }).click();
  await p
    .getByRole("button", { name: "Confirmar borrado", exact: true })
    .click();
  await p.waitForFunction(
    () =>
      !window.qaDirectory
        .get("demo-conv-1")
        .snapshot()
        .data.tasks.some((t) => t.title === "Desde ficha QA"),
  );
  checks.push(
    "Actual Contact TaskSheet → Work; deletion propagates back to contact",
  );

  await p.evaluate(async () => {
    for (let i = 0; i < 30; i++)
      await window
        .qaWork()
        .saveTask({
          title: "Scroll QA " + i,
          notes: "",
          due: Date.now() + 86400000,
          assignee: "demo-owner",
          contactId: null,
        });
  });
  await p.getByTestId("work-task-list").evaluate((el) => {
    el.scrollTop = 420;
    el.dispatchEvent(new Event("scroll"));
  });
  await p.waitForTimeout(130);
  const offset = await p
    .getByTestId("work-task-list")
    .evaluate((el) => el.scrollTop);
  assert.ok(offset > 100);
  await p.evaluate(() => window.qaNavigate("/results"));
  await p.getByRole("heading", { name: "Resultados", exact: true }).waitFor();
  await p.evaluate(() => window.qaGoBack());
  await p.waitForTimeout(100);
  assert.ok(
    Math.abs(
      (await p.getByTestId("work-task-list").evaluate((el) => el.scrollTop)) -
        offset,
    ) < 3,
  );
  checks.push(
    "Actual Work scroll restored after navigating to Results and back",
  );
  await mount("dark", "advisor");
  assert.equal(
    await p
      .getByRole("button", { name: "Todo el equipo", exact: true })
      .count(),
    0,
  );
  checks.push("Advisor has own scope; no team filter");
  for (const status of ["loading", "empty", "offline", "error"]) {
    await mount();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await p.waitForTimeout(60);
    await p.screenshot({
      path: path.join(out, `state-${status}-light-390x844.png`),
    });
  }
  checks.push("Loading, empty, offline and error states captured");
  const reference = await context.newPage();
  await reference.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await reference.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of ["CRM-30", "CRM-31", "CRM-32", "CRM-33"]) {
      await reference.evaluate(
        ({ theme, id }) => {
          S.theme = theme;
          go(id);
        },
        { theme, id },
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
        ids: ["CRM-30", "CRM-31", "CRM-32", "CRM-33"],
        checks,
        errors,
        networkRequests: networkCount(),
        actualCaptures: 20,
        officialReferences: 8,
        native: false,
        httpServerStarted: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }));
  await p.close();
  await reference.close();
}

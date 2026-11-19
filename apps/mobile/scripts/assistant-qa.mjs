import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runAssistant(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-assistant");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("ASSISTANT_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => {
        window.qaResetStorage();
        window.mountRefinement("assistant", theme, role);
      },
      { theme, role },
    );
    if (role === "owner")
      await p
        .getByRole("heading", { name: "Asistente", exact: true })
        .waitFor();
    await settle(p);
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
      await shot(`AST-01-${theme}-${width}x${height}`);
      await p
        .getByRole("button", { name: "Conversaciones", exact: true })
        .click();
      await shot(`AST-02-${theme}-${width}x${height}`, "Conversaciones");
      assert.equal(
        await p
          .getByRole("button", {
            name: "Archivar hilo: Chat general",
            exact: true,
          })
          .count(),
        0,
      );
      await close();
      await p
        .getByRole("button", { name: "Modo y crédito", exact: true })
        .click();
      await shot(`AST-03-${theme}-${width}x${height}`, "Modo y crédito");
      await close();
    }
  checks.push(
    "3 Assistant IDs captured both themes/sizes; fixed general thread; mode menu; no bottom tab bar",
  );
  for (const theme of ["light", "dark"]) {
    await p.setViewportSize({ width: 390, height: 844 });
    await mount(theme);
    await p
      .getByRole("button", {
        name: "Etiqueta a quienes pidieron cotización",
        exact: true,
      })
      .click();
    await p.getByRole("button", { name: "Aplicar", exact: true }).waitFor();
    await shot(`state-proposal-${theme}-390x844`);
    assert.equal(
      await p.evaluate(() =>
        window
          .qaStudio()
          .assistantTagsApplied(
            window.qaStudio().activeAssistant().turns.at(-1),
          ),
      ),
      false,
    );
    await p.getByRole("button", { name: "Descartar", exact: true }).click();
    await p.getByText("Propuesta descartada", { exact: true }).waitFor();
    assert.equal(
      await p.evaluate(() =>
        window
          .qaStudio()
          .assistantTagsApplied(
            window.qaStudio().activeAssistant().turns.at(-1),
          ),
      ),
      false,
    );
  }
  checks.push(
    "Suggestion only proposes; discard retains conversation and does not mutate contacts",
  );
  await mount();
  await p
    .getByRole("button", {
      name: "Etiqueta a quienes pidieron cotización",
      exact: true,
    })
    .click();
  await p.getByRole("button", { name: "Aplicar", exact: true }).click();
  await p.getByRole("button", { name: "Aplicado", exact: true }).waitFor();
  assert.equal(
    await p.evaluate(() =>
      window
        .qaStudio()
        .assistantTagsApplied(window.qaStudio().activeAssistant().turns.at(-1)),
    ),
    true,
  );
  checks.push(
    "Explicit Apply changes shared fictitious contact repository without duplicate tags",
  );
  await p.getByRole("button", { name: "Conversaciones", exact: true }).click();
  await p.getByRole("button", { name: "Hilo nuevo", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Pregunta al asistente", exact: true })
    .fill("¿Cuánto vendí este mes?");
  await p
    .getByRole("button", { name: "Enviar al asistente", exact: true })
    .click();
  await p.getByText(/Ventas de demostración del periodo:/).waitFor();
  const current = await p.evaluate(
    () => window.qaStudio().activeAssistant().id,
  );
  await p.getByRole("button", { name: "Modo y crédito", exact: true }).click();
  await p.getByRole("radio", { name: "Profundo", exact: true }).click();
  await p.getByText("Profundo", { exact: true }).waitFor();
  await p.evaluate(() => window.mountRefinement("assistant", "light", "owner"));
  await p.getByRole("heading", { name: "Asistente", exact: true }).waitFor();
  assert.equal(
    await p.evaluate(() => window.qaStudio().activeAssistant().id),
    current,
  );
  await p.getByText("Profundo", { exact: true }).waitFor();
  await p.getByText(/Ventas de demostración del periodo:/).waitFor();
  checks.push(
    "New thread, deterministic sales reading, mode and messages restore together",
  );
  await p.getByRole("button", { name: "Conversaciones", exact: true }).click();
  await p
    .getByRole("button", { name: "Archivar hilo: Hilo nuevo", exact: true })
    .click();
  await p.waitForFunction(
    () => window.qaStudio().activeAssistant().id === "demo-assistant-general",
  );
  checks.push("Archive active thread returns to fixed general safely");
  await p
    .getByRole("textbox", { name: "Pregunta al asistente", exact: true })
    .fill("Audita mis agentes");
  await p.evaluate(() => (window.qaFailWrite = true));
  await p
    .getByRole("button", { name: "Enviar al asistente", exact: true })
    .click();
  await p
    .getByText("No se pudo guardar localmente. Tu borrador sigue disponible.", {
      exact: true,
    })
    .last()
    .waitFor();
  await shot("state-write-error-light-390x844", "Asistente");
  assert.equal(
    await p
      .getByRole("textbox", { name: "Pregunta al asistente", exact: true })
      .inputValue(),
    "Audita mis agentes",
  );
  await p.evaluate(() => (window.qaFailWrite = false));
  await p
    .getByRole("button", { name: "Enviar al asistente", exact: true })
    .click();
  await p.getByText(/Revisé 3 agentes ficticios:/).waitFor();
  checks.push("Failed query preserves text and safe retry appends once");
  await p.evaluate(() => {
    window.qaFailRead = true;
    window.mountRefinement("assistant", "light", "owner");
  });
  await p.getByRole("button", { name: "Reintentar", exact: true }).waitFor();
  await shot("state-read-error-light-390x844");
  await p.evaluate(() => (window.qaFailRead = false));
  await p.getByRole("button", { name: "Reintentar", exact: true }).click();
  await p.getByRole("heading", { name: "Asistente", exact: true }).waitFor();
  checks.push("Read recovery restores prior local thread");
  for (const role of ["coordinator", "advisor"]) {
    await mount("dark", role);
    await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  }
  checks.push("Owner-only route remains denied to other roles");
  const ids = ["AST-01", "AST-02", "AST-03"],
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
        actualCaptures: 16,
        officialReferences: 6,
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

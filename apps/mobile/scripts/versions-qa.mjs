import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runVersions(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-versions");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("VERSIONS_ERROR", e.message);
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
  };
  const editor = async () => {
    await p
      .getByRole("button", {
        name: "Editar agente: Ventas — general",
        exact: true,
      })
      .click();
    await p
      .getByRole("textbox", {
        name: "Nombre de presentación (opcional)",
        exact: true,
      })
      .waitFor();
  };
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  const menu = () =>
    p
      .getByRole("button", { name: "Más opciones del agente", exact: true })
      .click();
  const shot = async (name, title) => {
    await p.getByRole("heading", { name: title, exact: true }).waitFor();
    await settle(p);
    await p.screenshot({ path: path.join(out, name + ".png") });
  };
  const changeTone = async (tone) => {
    const field = p.getByRole("textbox", { name: "Tono", exact: true });
    if (!(await field.count()))
      await p
        .getByRole("button", { name: "Tono, contraído", exact: true })
        .click();
    await field.fill(tone);
    await p.waitForFunction(
      (tone) => window.qaStudio().get("demo-agent-a1").draft.tone === tone,
      tone,
    );
  };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await editor();
      await changeTone("Formal de prueba");
      await p.getByRole("button", { name: "Publicar", exact: true }).click();
      await shot(
        `LAB-05-${theme}-${width}x${height}`,
        "¿Publicar este agente?",
      );
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(
        await p.evaluate(
          () => window.qaStudio().get("demo-agent-a1").versions.length,
        ),
        1,
      );
      await p.getByRole("button", { name: "Publicar", exact: true }).click();
      await p
        .getByRole("heading", { name: "¿Publicar este agente?", exact: true })
        .waitFor();
      await p.getByRole("button", { name: "Publicar", exact: true }).click();
      await p.waitForFunction(
        () => window.qaStudio().get("demo-agent-a1").versions.length === 2,
      );
      await menu();
      await p
        .getByRole("button", { name: "Versiones publicadas", exact: true })
        .click();
      await shot(`LAB-06-${theme}-${width}x${height}`, "Versiones publicadas");
      await p
        .getByRole("button", { name: "Cargar", exact: true })
        .last()
        .click();
      await shot(
        `LAB-06C-${theme}-${width}x${height}`,
        "¿Cargar esta versión al borrador?",
      );
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      await p
        .getByRole("heading", { name: "Versiones publicadas", exact: true })
        .waitFor();
      await p
        .getByRole("button", { name: "Cargar", exact: true })
        .last()
        .click();
      await p
        .getByRole("heading", {
          name: "¿Cargar esta versión al borrador?",
          exact: true,
        })
        .waitFor();
      await p.getByRole("button", { name: "Cargar", exact: true }).click();
      await p.waitForFunction(
        () =>
          window.qaStudio().get("demo-agent-a1").draft.tone ===
          "Cercano y directo",
      );
      assert.equal(
        await p.evaluate(
          () =>
            window.qaStudio().get("demo-agent-a1").versions.at(-1).config.tone,
        ),
        "Formal de prueba",
      );
      await p.getByRole("button", { name: "Atrás", exact: true }).click();
      await p
        .getByRole("button", { name: "Más opciones de Agentes", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Pausar todos los agentes", exact: true })
        .click();
      await shot(
        `LAB-07-${theme}-${width}x${height}`,
        "¿Pausar todos los agentes de IA?",
      );
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(
        await p.evaluate(() => window.qaStudio().doc().globalPaused),
        false,
      );
      if (width === 390) {
        await p
          .getByRole("button", { name: "Más opciones de Agentes", exact: true })
          .click();
        await p
          .getByRole("button", {
            name: "Pausar todos los agentes",
            exact: true,
          })
          .click();
        await p.getByRole("button", { name: "Pausar", exact: true }).click();
        await p
          .getByRole("button", { name: "Reanudar", exact: true })
          .waitFor();
        await settle(p);
        await p.screenshot({
          path: path.join(out, `state-paused-${theme}-${width}x${height}.png`),
        });
        assert.equal(
          await p.evaluate(
            () => window.qaStudio().route("Cliente", "Hola").decision,
          ),
          "handoff",
        );
        await p.getByRole("button", { name: "Reanudar", exact: true }).click();
        await p.waitForFunction(() => !window.qaStudio().doc().globalPaused);
      }
    }
  checks.push(
    "4 IDs captured both themes/sizes; publication and load confirmations cancel/confirm; published config unaffected by old draft load",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await editor();
  await changeTone("Pub con reintento");
  await p.getByRole("button", { name: "Publicar", exact: true }).click();
  await p
    .getByRole("heading", { name: "¿Publicar este agente?", exact: true })
    .waitFor();
  await p.evaluate(() => (window.qaFailWrite = true));
  await p.getByRole("button", { name: "Publicar", exact: true }).click();
  await p
    .getByText("No se pudo guardar localmente. Tu borrador sigue disponible.", {
      exact: true,
    })
    .last()
    .waitFor();
  await shot("state-publication-error-light-390x844", "¿Publicar este agente?");
  assert.equal(
    await p.evaluate(
      () => window.qaStudio().get("demo-agent-a1").versions.length,
    ),
    1,
  );
  await p.evaluate(() => (window.qaFailWrite = false));
  await p.getByRole("button", { name: "Publicar", exact: true }).click();
  await p.waitForFunction(
    () => window.qaStudio().get("demo-agent-a1").versions.length === 2,
  );
  checks.push(
    "Failed publication stays in dialog; retry creates exactly one version",
  );
  const before = await p.evaluate(() =>
    JSON.stringify(window.qaStudio().get("demo-agent-a1").versions),
  );
  await changeTone("Después de publicar");
  assert.equal(
    await p.evaluate(() =>
      JSON.stringify(window.qaStudio().get("demo-agent-a1").versions),
    ),
    before,
  );
  await p.evaluate(() => window.mountRefinement("agents", "light", "owner"));
  await p
    .getByRole("button", {
      name: "Editar agente: Ventas — general",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await p.evaluate(() => window.qaStudio().get("demo-agent-a1").draft.tone),
    "Después de publicar",
  );
  assert.equal(
    await p.evaluate(
      () => window.qaStudio().get("demo-agent-a1").versions.at(-1).config.tone,
    ),
    "Pub con reintento",
  );
  checks.push(
    "Saved draft and independent published history survive session-provider remount",
  );
  await p.evaluate(() => window.qaNavigate("/studio-agent/demo-agent-a3"));
  await p
    .getByRole("textbox", {
      name: "Nombre de presentación (opcional)",
      exact: true,
    })
    .waitFor();
  await menu();
  await p
    .getByRole("button", { name: "Versiones publicadas", exact: true })
    .click();
  await shot("state-empty-versions-light-390x844", "Versiones publicadas");
  await p.getByText("Sin versiones publicadas", { exact: true }).waitFor();
  checks.push("Agent with no published version has a usable empty state");
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  const ids = ["LAB-05", "LAB-06", "LAB-06C", "LAB-07"];
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
        actualCaptures: 20,
        officialReferences: 8,
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

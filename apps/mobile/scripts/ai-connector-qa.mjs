import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runConnector(context, html, root, requests) {
  const out = path.join(root, "artifacts/ai-connector");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("CONNECTOR_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  const nav = async (route) => {
      await p.evaluate((r) => window.qaNavigate(r), route);
      await settle(p);
    },
    button = (name) => p.getByRole("button", { name, exact: true }),
    heading = (name) => p.getByRole("heading", { name, exact: true });
  await p.evaluate(() => window.mountRefinement("inbox", "light"));
  await settle(p);
  await nav("/my-ai");
  await p.getByText("Sin conexiones", {exact:true}).waitFor();
  await button("Simular autorización · Claude").click();
  await button("Autorizar muestra").click();
  await button("Claude · «Joe» · Activa").waitFor();
  await nav("/ai-connector-lab");
  for (const name of [
    "Simuló propuesta de mensaje",
    "Simuló etiquetado",
    "Simuló propuesta de tarea",
  ]) {
    await button(name).click();
    await p.waitForFunction(
      () => window.qaConnector().ownActivity().length > 0,
    );
    await settle(p);
  }
  await p.waitForFunction(
    () => window.qaConnector().ownActivity().length === 3,
  );
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate((t) => (window.qaTheme = t), theme);
      for (const [id, route, title] of [
        ["SET-12", "/ai-connector-settings", "Conector del equipo"],
        ["SET-11", "/my-ai", "Mi IA"],
        ["SET-11A", "/my-ai-activity", "Qué hizo tu IA"],
      ]) {
        await nav(route);
        await heading(title).waitFor();
        await settle(p);
        await p.screenshot({
          path: path.join(out, `${id}-${theme}-${width}x${height}.png`),
        });
      }
    }
  await nav("/my-ai");
  await button("Copiar").click();
  await button("Claude · «Joe» · Activa").click();
  await p
    .getByRole("textbox", { name: "Nombre de la conexión", exact: true })
    .fill("Mi asistente");
  await button("Guardar nombre").click();
  await button("Claude · «Mi asistente» · Activa").waitFor();
  await nav("/ai-connector-settings");
  const limit = p.getByRole("textbox", {
    name: "Tope diario de acciones por persona",
    exact: true,
  });
  await limit.fill("0");
  await button("Guardar tope").click();
  await p.getByText("Conector ficticio no válido.", { exact: true }).waitFor();
  await limit.fill("4");
  await p.evaluate(() => (window.qaFailWrite = true));
  await button("Guardar tope").click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  assert.equal(
    await p.evaluate(
      () => window.qaConnector().snapshot().doc.policy.dailyLimit,
    ),
    100,
  );
  await p.evaluate(() => (window.qaFailWrite = false));
  await button("Guardar tope").click();
  await p.waitForFunction(
    () => window.qaConnector().snapshot().doc.policy.dailyLimit === 4,
  );
  await nav("/ai-connector-lab");
  await button("Simuló exportación/importación").click();
  await p
    .getByText("Función avanzada no permitida.", { exact: true })
    .waitFor();
  await button("Simuló propuesta de tarea").click();
  await p.waitForFunction(() => window.qaConnector().usedToday() === 4);
  await button("Simuló propuesta de tarea").click();
  await p
    .getByText("Tope diario ficticio alcanzado.", { exact: true })
    .waitFor();
  await nav("/my-ai");
  await button("Claude · «Mi asistente» · Activa").click();
  await button("Revocar conexión").click();
  await button("Cancelar").click();
  await nav("/my-ai");
  await button("Claude · «Mi asistente» · Activa").click();
  await button("Revocar conexión").click();
  await button("Confirmar").click();
  await nav("/ai-connector-lab");
  await button("Simuló propuesta de tarea").click();
  await p
    .getByText("Conexión revocada o requiere reautorizar.", { exact: true })
    .first()
    .waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "advisor"));
  await settle(p);
  await nav("/ai-connector-settings");
  await p.getByText("Acceso no permitido", {exact:true}).waitFor();
  await nav("/my-ai");
  await p.getByText("Sin conexiones", {exact:true}).waitFor();
  await button("Simular autorización · Claude").click();
  await button("Autorizar muestra").click();
  await p
    .getByText("El conector no está permitido para tu rol.", { exact: true })
    .waitFor();
  await button("Cancelar").click();
  await nav("/my-ai-activity");
  await p.getByText("Sin actividad", {exact:true}).waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "owner"));
  await settle(p);
  await nav("/my-ai");
  await button("Claude · «Mi asistente» · Sin autorización").waitFor();
  await nav("/my-ai-activity");
  assert.equal(
    await p.evaluate(() => window.qaConnector().ownActivity().length),
    4,
  );
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of ["SET-12", "SET-11", "SET-11A"]) {
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
  assert.equal(requests(), 0);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        captures: 12,
        references: 6,
        errors,
        requests: requests(),
        native: false,
        checks: [
          "Connect, rename, revoke/cancel",
          "Daily cap and advanced action denial",
          "Config validation and save failure/retry",
          "Role denial, actor isolation, session restoration",
          "Log contains only enum metadata",
        ],
      },
      null,
      2,
    ),
  );
  await p.close();
  await ref.close();
  console.log("AI connector QA passed");
}

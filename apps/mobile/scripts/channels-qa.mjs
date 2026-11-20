import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runChannels(context, html, root, requests) {
  const out = path.join(root, "artifacts/channels");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("CHANNEL_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  const nav = async (r) => {
      await p.evaluate((r) => window.qaNavigate(r), r);
      await settle(p);
    },
    b = (name) => p.getByRole("button", { name, exact: true }),
    shot = async (name) => {
      await settle(p);
      await p.screenshot({ path: path.join(out, name + ".png") });
    };
  await p.evaluate(() => window.mountRefinement("inbox", "light"));
  await settle(p);
  await nav("/direct-settings");
  await p.getByText("Complemento no disponible", { exact: true }).waitFor();
  await nav("/channel-lab");
  await b("Activar complemento ficticio").click();
  await nav("/direct-settings");
  await b("Vincular muestra ficticia").click();
  await b("Simular vinculación").click();
  await p.getByRole("radio", { name: "Conexión directa", exact: true }).click();
  await p.waitForFunction(
    () => window.qaChannels().snapshot().doc.defaultMode === "direct",
  );
  await b("Aplicar a todos los chats").click();
  await b("Cancelar").click();
  await b("Aplicar a todos los chats").click();
  await b("Confirmar").click();
  assert.equal(
    await p.evaluate(() => window.qaChannels().snapshot().doc.epoch),
    1,
  );
  await nav("/channel-settings");
  await b("Conectar con Facebook").click();
  await b("Continuar con Facebook").click();
  await p
    .getByText("Conectado en simulación · +1 555 010 0100", { exact: true })
    .waitFor();
  for (const theme of ["light", "dark"]) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate((t) => (window.qaTheme = t), theme);
    await nav("/channel-settings");
    await shot(`SET-02-${theme}-390x844`);
    await b("Conectar con Facebook").click();
    await shot(`SET-02A-${theme}-390x844`);
    await b("Cerrar").click();
    await b("Salud del número").click();
    await shot(`SET-02B-${theme}-390x844`);
    await b("Cerrar").click();
    await nav("/direct-settings");
    await shot(`SET-02C-${theme}-390x844`);
    await nav("/ads-settings");
    await shot(`SET-04-${theme}-390x844`);
  }
  await p
    .getByRole("switch", {
      name: "Reportar eventos a Meta (CAPI)",
      exact: true,
    })
    .click();
  await p.evaluate(() => (window.qaFailWrite = true));
  await b("Guardar").click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  await p.evaluate(() => (window.qaFailWrite = false));
  await b("Guardar").click();
  await p.waitForFunction(() => window.qaChannels().snapshot().doc.ads);
  await nav("/channel-lab");
  await b("Simular Lead").click();
  await b("Simular Lead").click();
  await p.waitForFunction(
    () => window.qaChannels().snapshot().doc.events.length === 1,
  );
  await b("Calidad Baja").click();
  await nav("/channel-settings");
  await b("Desconectar").click();
  await b("Cancelar").click();
  await b("Desconectar").click();
  await b("Confirmar").click();
  await p.getByText("Sin conexión ficticia", { exact: true }).waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "advisor"));
  await settle(p);
  await nav("/channel-settings");
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "owner"));
  await settle(p);
  await nav("/channel-settings");
  await p.getByText("Sin conexión ficticia", { exact: true }).waitFor();
  assert.equal(
    await p.evaluate(() => window.qaChannels().snapshot().doc.quality),
    "Baja",
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
    for (const id of ["SET-02", "SET-02A", "SET-02B", "SET-02C", "SET-04"]) {
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
    JSON.stringify({
      captures: 10,
      references: 10,
      errors,
      requests: requests(),
      native: false,
    }),
  );
  await p.close();
  await ref.close();
  console.log("Channels QA passed");
}

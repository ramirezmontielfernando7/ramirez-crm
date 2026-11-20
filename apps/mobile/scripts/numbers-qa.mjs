import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runNumbers(context, html, root, requests) {
  const out = path.join(root, "artifacts/numbers");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  const nav = async (route) => {
    await p.evaluate((r) => window.qaNavigate(r), route);
    await settle(p);
  };
  await p.evaluate(() => window.mountRefinement("inbox", "light"));
  await settle(p);
  await nav("/personal-settings");
  await p
    .getByRole("button", { name: "Vincular otro dispositivo", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Simular vinculación", exact: true })
    .click();
  await p
    .getByText("Vinculado en simulación · Teléfono ficticio", { exact: true })
    .waitFor();
  await p
    .getByText("Dispositivo ficticio vinculado", { exact: true })
    .waitFor({ state: "hidden", timeout: 6000 });
  const close = () =>
      p.getByRole("button", { name: "Cerrar", exact: true }).click(),
    shot = async (name) => {
      await settle(p);
      await p.screenshot({ path: path.join(out, name + ".png") });
    };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate((t) => (window.qaTheme = t), theme);
      await nav("/(tabs)/inbox?area=number");
      await p
        .getByRole("button", { name: "Nuevo chat personal", exact: true })
        .click();
      await shot(`NUM-04-${theme}-${width}x${height}`);
      await p
        .getByRole("textbox", { name: "Número de teléfono", exact: true })
        .fill("+1 555 010 0001");
      await p.getByRole("button", { name: "Abrir chat", exact: true }).click();
      await p
        .getByRole("textbox", { name: "Mensaje personal", exact: true })
        .waitFor();
      await shot(`NUM-02-${theme}-${width}x${height}`);
      await p
        .getByRole("button", {
          name: "Opciones del chat personal",
          exact: true,
        })
        .click();
      await shot(`NUM-03-${theme}-${width}x${height}`);
      await close();
      await nav("/(tabs)/inbox?area=number");
      await shot(`NUM-01-${theme}-${width}x${height}`);
    }
  await nav("/personal-chat?id=personal-15550100001");
  await p
    .getByRole("textbox", { name: "Mensaje personal", exact: true })
    .fill("Hola ficticio");
  await p.getByRole("button", { name: "Enviar personal", exact: true }).click();
  await p.getByText("Hola ficticio", { exact: true }).waitFor();
  await p
    .getByRole("button", { name: "Opciones del chat personal", exact: true })
    .click();
  await p.getByRole("switch", { name: "Privado", exact: true }).click();
  await close();
  await nav("/personal-settings");
  await p.getByRole("switch").first().click();
  await settle(p);
  await nav("/personal-chat?id=personal-15550100001");
  await p
    .getByRole("button", { name: "Opciones del chat personal", exact: true })
    .click();
  await p.getByRole("switch", { name: "Es cliente", exact: true }).click();
  await p
    .getByRole("button", { name: "Confirmar traspaso ficticio", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "Contacto ficticio 0001", exact: true })
    .waitFor();
  assert.equal(await p.getByText("Hola ficticio", { exact: true }).count(), 0);
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of ["NUM-01", "NUM-02", "NUM-03", "NUM-04"]) {
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
      captures: 16,
      references: 8,
      errors,
      requests: requests(),
      native: false,
    }),
  );
  console.log("Numbers QA passed");
  await p.close();
  await ref.close();
}

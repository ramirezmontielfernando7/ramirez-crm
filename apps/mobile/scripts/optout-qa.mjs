import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runOptout(context, html, root, requests) {
  const out = path.join(root, "artifacts/optout");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  const nav = async (r) => {
    await p.evaluate((r) => window.qaNavigate(r), r);
    await settle(p);
  };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate((t) => window.mountRefinement("inbox", t), theme);
      await settle(p);
      await nav("/optout");
      await p.getByRole("button", { name: "Agregar", exact: true }).waitFor();
      await settle(p);
      await p.screenshot({
        path: path.join(out, `SET-10-${theme}-${width}x${height}.png`),
      });
    }
  await p.getByRole("button", { name: "Agregar", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Palabra clave", exact: true })
    .fill("SALIR");
  await p.getByRole("button", { name: "Agregar palabra", exact: true }).click();
  await p.getByRole("button", { name: "SALIR", exact: true }).waitFor();
  await nav("/optout-lab");
  await p
    .getByRole("button", { name: /Probar baja/ })
    .first()
    .click();
  await p.getByRole("button", { name: "Simular STOP", exact: true }).click();
  await p
    .getByText("Eventos ejecutados ficticios: 1", { exact: true })
    .waitFor();
  await nav("/conversation/demo-conv-1");
  await p
    .getByText("Contacto dado de baja · envíos simulados bloqueados", {
      exact: true,
    })
    .waitFor();
  await nav("/optout");
  await p.getByRole("switch").click();
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(
    await p.getByRole("switch").getAttribute("aria-checked"),
    "true",
  );
  await p.evaluate(() => window.mountRefinement("inbox", "light", "advisor"));
  await settle(p);
  await nav("/optout");
  await p
    .getByText("Solo propietario o coordinador configura esta muestra.", {
      exact: true,
    })
    .waitFor();
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"]) {
    await ref.evaluate((t) => {
      S.theme = t;
      go("SET-10");
    }, theme);
    await ref
      .locator("#ph")
      .screenshot({ path: path.join(out, `reference-SET-10-${theme}.png`) });
  }
  assert.deepEqual(errors, []);
  assert.equal(requests(), 0);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify({
      captures: 4,
      references: 2,
      errors,
      requests: requests(),
      native: false,
    }),
  );
  console.log("Optout QA passed");
  await p.close();
  await ref.close();
}

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runPersonal(context, html, root, requests) {
  const out = path.join(root, "artifacts/personal");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate((t) => window.mountRefinement("inbox", t), theme);
      await p.evaluate(() => window.qaNavigate("/personal-settings"));
      await p
        .getByRole("button", { name: "Vincular otro dispositivo", exact: true })
        .waitFor();
      await settle(p);
      await p.screenshot({
        path: path.join(out, `SET-13-${theme}-${width}x${height}.png`),
      });
      await p
        .getByRole("button", { name: "Vincular otro dispositivo", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Renovar código", exact: true })
        .click();
      await settle(p);
      await p.screenshot({
        path: path.join(out, `SET-13A-${theme}-${width}x${height}.png`),
      });
      await p
        .getByRole("button", { name: "Simular vinculación", exact: true })
        .click();
      await p
        .getByText("Vinculado en simulación · Teléfono ficticio", {
          exact: true,
        })
        .waitFor();
    }
  const sw = p.getByRole("switch").first();
  await sw.click();
  await p.waitForFunction(
    () =>
      document.querySelector("[role=switch]")?.getAttribute("aria-checked") ===
      "true",
  );
  await p.evaluate(() => window.mountRefinement("inbox", "light", "advisor"));
  await settle(p);
  await p.evaluate(() => window.qaNavigate("/personal-settings"));
  await settle(p);
  await p
    .getByRole("button", { name: "Vincular otro dispositivo", exact: true })
    .waitFor();
  assert.equal(
    await p.getByRole("switch").first().getAttribute("aria-checked"),
    "false",
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
    for (const id of ["SET-13", "SET-13A"]) {
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
  await ref.close();
  assert.deepEqual(errors, []);
  assert.equal(requests(), 0);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify({
      captures: 8,
      errors,
      requests: requests(),
      native: false,
    }),
  );
  await p.close();
  console.log("Personal settings QA passed");
}

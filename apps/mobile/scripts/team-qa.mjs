import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runTeam(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/team-integration");
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
      await p.evaluate((theme) => window.mountRefinement("team", theme), theme);
      await p
        .getByRole("button", { name: "Invitar persona", exact: true })
        .waitFor();
      await settle(p);
      await p.screenshot({
        path: path.join(out, `SET-03-${theme}-${width}x${height}.png`),
      });
      await p
        .getByRole("button", { name: "Invitar persona", exact: true })
        .click();
      await p
        .getByRole("heading", { name: "Invitar persona", exact: true })
        .waitFor();
      await settle(p);
      await p.screenshot({
        path: path.join(out, `SET-03A-${theme}-${width}x${height}.png`),
      });
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      await p.getByRole("button", { name: /Ana López · Coordinador/ }).click();
      await p
        .getByRole("heading", { name: "Ana López", exact: true })
        .waitFor();
      await settle(p);
      await p.screenshot({
        path: path.join(out, `SET-03B-${theme}-${width}x${height}.png`),
      });
      await p.getByRole("button", { name: "Cerrar", exact: true }).click();
    }
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of ["SET-03", "SET-03A", "SET-03B"]) {
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
  assert.equal(networkCount(), 0);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        actualCaptures: 12,
        errors,
        networkRequests: networkCount(),
        native: false,
        complete: false,
        remaining:
          "Restablecimiento ficticio, confirmación de desactivación y regresión completa de permisos",
      },
      null,
      2,
    ),
  );
  console.log("Team preliminary UI captures passed");
  await p.close();
}

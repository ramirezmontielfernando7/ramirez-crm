import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runOpening(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-opening");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate(
        (theme) => window.mountRefinement("opening", theme),
        theme,
      );
      await p.getByText("Dashfort", { exact: true }).waitFor();
      await settle(p);
      assert.equal(
        await p.getByRole("tab", { name: "Bandeja", exact: true }).count(),
        0,
      );
      await p.screenshot({
        path: path.join(out, `AUTH-01-${theme}-${width}x${height}.png`),
      });
    }
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"]) {
    await ref.evaluate((theme) => {
      S.theme = theme;
      go("AUTH-01");
    }, theme);
    await ref
      .locator("#ph")
      .screenshot({ path: path.join(out, `reference-AUTH-01-${theme}.png`) });
  }
  assert.deepEqual(errors, []);
  assert.equal(networkCount(), 0);
  const result = {
    ids: ["AUTH-01"],
    checks: [
      "Approved opening component in both themes/sizes without bottom tabs; reduced-motion static presentation in this host",
    ],
    actualCaptures: 4,
    officialReferences: 2,
    errors,
    networkRequests: networkCount(),
    httpServerStarted: false,
    native: false,
    animationTimingMeasuredInBrowser: false,
  };
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  await p.close();
  await ref.close();
}

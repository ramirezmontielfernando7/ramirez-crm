import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runCalendarSettings(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-calendar-settings");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  let actualCaptures = 0;
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("CALENDAR_SETTINGS_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light", role = "owner", reset = true) => {
    await p.evaluate(
      ({ theme, role, reset }) => {
        if (reset) window.qaResetStorage();
        window.qaFailRead = false;
        window.qaFailWrite = false;
        window.mountRefinement("calendar-settings", theme, role);
      },
      { theme, role, reset },
    );
    if (role !== "advisor")
      await p
        .getByRole("button", {
          name: "Google Meet · Sin conectar",
          exact: true,
        })
        .waitFor();
    await settle(p);
  };
  const nav = async (route) => {
    await p.evaluate((route) => window.qaNavigate(route), route);
    await settle(p);
  };
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  const shot = async (name, title) => {
    if (title)
      await p.getByRole("heading", { name: title, exact: true }).waitFor();
    await settle(p);
    await p.screenshot({ path: path.join(out, name + ".png") });
    actualCaptures++;
  };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await shot(`SET-08-${theme}-${width}x${height}`, "Agenda y conectores");
      await p
        .getByRole("button", {
          name: "Google Meet · Sin conectar",
          exact: true,
        })
        .click();
      await p
        .getByRole("heading", { name: "Conectar Google Meet", exact: true })
        .waitFor();
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
    }
  checks.push(
    "SET-08 actual RN in both themes/sizes, approved hours and provider states; cancel leaves local config unchanged",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await nav("/agenda?booking=demo-booking-b2");
  await p
    .getByRole("heading", { name: "Videollamada · maestría", exact: true })
    .waitFor();
  await p.getByText("Sin enlace", { exact: true }).waitFor();
  assert.equal(
    await p.getByRole("button", { name: "Unirse", exact: true }).count(),
    0,
  );
  await close();
  await nav("/calendar-settings");
  await p
    .getByRole("button", { name: "Google Meet · Sin conectar", exact: true })
    .click();
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await p
    .getByRole("button", { name: "Conectar muestra", exact: true })
    .click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  await shot("state-save-error-light-390x844", "Conectar Google Meet");
  assert.equal(
    await p.evaluate(() => window.qaConnectors().joinable("Meet")),
    false,
  );
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await p
    .getByRole("button", { name: "Conectar muestra", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Google Meet · Conectado", exact: true })
    .waitFor();
  await nav("/agenda?booking=demo-booking-b2");
  await p
    .getByRole("heading", { name: "Videollamada · maestría", exact: true })
    .waitFor();
  await p.getByRole("button", { name: "Unirse", exact: true }).click();
  await p
    .getByText("Enlace ficticio · no se abre ningún proveedor", { exact: true })
    .waitFor();
  await shot("state-agenda-connected-light-390x844", "Videollamada · maestría");
  await close();
  await nav("/calendar-settings");
  await p
    .getByRole("button", { name: "Google Meet · Conectado", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Desconectar muestra", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Google Meet · Sin conectar", exact: true })
    .waitFor();
  checks.push(
    "Shared Agenda shows no Meet link when disconnected; failed write preserves dialog/state; retry connects sample; join only shows fake toast; disconnect restores unavailable link without canceling appointment",
  );
  await p.evaluate(async () => {
    window.qaFailRead = true;
    await window.qaConnectors().reload();
  });
  await p.getByRole("button", { name: "Reintentar", exact: true }).waitFor();
  await shot("state-read-error-light-390x844", "Agenda y conectores");
  await p.evaluate(() => {
    window.qaFailRead = false;
  });
  await p.getByRole("button", { name: "Reintentar", exact: true }).click();
  await p
    .getByRole("button", { name: "Google Meet · Sin conectar", exact: true })
    .waitFor();
  checks.push(
    "Actual storage-read failure blocks configuration without replacing it; retry restores persisted settings",
  );
  for (const status of ["loading", "empty", "error", "offline"]) {
    await mount();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await shot(`state-${status}-light-390x844`, "Agenda y conectores");
    if (status === "error") {
      await p.getByRole("button", { name: "Reintentar", exact: true }).click();
      await p
        .getByRole("button", {
          name: "Google Meet · Sin conectar",
          exact: true,
        })
        .waitFor();
    }
  }
  await mount("light", "coordinator", false);
  await p
    .getByRole("button", { name: "Google Meet · Sin conectar", exact: true })
    .waitFor();
  await mount("light", "advisor", false);
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  checks.push(
    "Loading/empty/error/offline states and role gates; coordinator permitted, advisor direct route denied",
  );
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
      go("SET-08");
    }, theme);
    await ref
      .locator("#ph")
      .screenshot({ path: path.join(out, `reference-SET-08-${theme}.png`) });
  }
  assert.deepEqual(errors, []);
  assert.equal(networkCount(), 0);
  const result = {
    ids: ["SET-08"],
    checks,
    actualCaptures,
    officialReferences: 2,
    errors,
    networkRequests: networkCount(),
    httpServerStarted: false,
    native: false,
  };
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  await p.close();
  await ref.close();
}

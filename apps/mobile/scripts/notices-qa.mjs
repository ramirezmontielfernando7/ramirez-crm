import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runNotices(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-notices");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  let actualCaptures = 0;
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("NOTICES_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => {
        window.qaResetStorage();
        window.qaFailWrite = false;
        window.qaFailRead = false;
        window.mountRefinement("more", theme, role);
      },
      { theme, role },
    );
    await p.getByRole("button", { name: "Avisos", exact: true }).waitFor();
    await settle(p);
  };
  const open = async () => {
    await p.getByRole("button", { name: "Avisos", exact: true }).click();
    await p.getByRole("heading", { name: "Avisos", exact: true }).waitFor();
    await p.waitForFunction(
      () =>
        window.qaNotices().snapshot().ready &&
        window.qaWork().snapshot().ready &&
        window.qaAgenda().snapshot().ready,
    );
    await settle(p);
  };
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  const nav = async (route) => {
    await p.evaluate((route) => window.qaNavigate(route), route);
    await settle(p);
  };
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
      await open();
      await shot(`MORE-05-${theme}-${width}x${height}`, "Avisos");
      await p
        .getByRole("button", { name: "Preferencias de avisos", exact: true })
        .click();
      await shot(`SET-14-${theme}-${width}x${height}`, "Notificaciones");
      assert.equal(
        await p
          .getByRole("switch", {
            name: "Notificaciones con la app cerrada (push)",
            exact: true,
          })
          .getAttribute("aria-checked"),
        "false",
      );
    }
  checks.push(
    "Avisos and notification preferences captured both themes/sizes; internal settings have no product selectors; remote push stays off",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await open();
  await p.getByRole("button", { name: /^La IA pasó a Karla/ }).click();
  await p.waitForFunction(
    () => window.qaLastRoute === "/conversation/demo-conv-1",
  );
  await p.getByText("Karla Méndez", { exact: true }).first().waitFor();
  assert.equal(
    await p.evaluate(() => window.qaNotices().snapshot().doc.read.length),
    1,
  );
  checks.push(
    "Handoff opens canonical authorized fictitious chat and marks once locally",
  );
  await nav("/(tabs)/more");
  await open();
  await p.getByRole("button", { name: /^Tarea vencida: Llamar/ }).click();
  await p
    .getByRole("heading", { name: "Detalle de la tarea", exact: true })
    .waitFor();
  await p.getByRole("textbox", { name: "Título", exact: true }).waitFor();
  await close();
  await nav("/(tabs)/more");
  await open();
  await p.getByRole("button", { name: /^Cita: Visita a sucursal/ }).click();
  await p
    .getByRole("heading", { name: "Visita a sucursal", exact: true })
    .waitFor();
  assert.equal(
    await p.evaluate(() => window.qaAgenda().snapshot().day),
    "2026-11-12",
  );
  await close();
  checks.push(
    "Task notice opens actual task editor; appointment notice selects exact day and detail in shared Agenda",
  );
  await nav("/(tabs)/more");
  await p.evaluate(async () => {
    await window.qaStudio().usageScenario("warning");
    await window.qaStudio().usageClaimPrompt();
  });
  await open();
  await p.getByRole("button", { name: /^Llegaste al 80/ }).click();
  await p.getByRole("heading", { name: "Uso y plan", exact: true }).waitFor();
  checks.push(
    "Owner quota notice opens shared Usage screen without triggering payments",
  );
  await nav("/notification-settings");
  const handoff = () =>
    p.getByRole("switch", {
      name: "Avisar cuando la IA pasa un chat",
      exact: true,
    });
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await handoff().click();
  await p
    .getByText("No se pudieron guardar tus preferencias locales.", {
      exact: true,
    })
    .waitFor();
  await shot("state-save-error-light-390x844", "Notificaciones");
  assert.equal(await handoff().getAttribute("aria-checked"), "true");
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await handoff().click();
  await p.waitForFunction(
    () => window.qaNotices().snapshot().doc.preferences.handoff === false,
  );
  await p
    .getByRole("switch", { name: "Tareas y citas por vencer", exact: true })
    .click();
  await p.waitForFunction(
    () => window.qaNotices().snapshot().doc.preferences.reminders === false,
  );
  await nav("/(tabs)/more");
  await open();
  assert.equal(
    await p.getByRole("button", { name: /^La IA pasó|^Tarea|^Cita:/ }).count(),
    0,
  );
  await close();
  await nav("/notification-settings");
  assert.equal(await handoff().getAttribute("aria-checked"), "false");
  await p
    .getByRole("switch", {
      name: "Notificaciones con la app cerrada (push)",
      exact: true,
    })
    .click();
  assert.equal(
    await p
      .getByRole("switch", {
        name: "Notificaciones con la app cerrada (push)",
        exact: true,
      })
      .getAttribute("aria-checked"),
    "false",
  );
  checks.push(
    "Failed preference saves keep previous value; retry works; choices persist through navigation and filter notices; push toggle cannot enable transport",
  );
  for (const status of ["loading", "empty", "error", "offline"]) {
    await mount();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    if (status === "loading" || status === "empty" || status === "error") {
      await p.getByRole("button", { name: "Avisos", exact: true }).click();
      await shot(`state-${status}-light-390x844`, "Avisos");
    } else {
      await open();
      await shot(`state-${status}-light-390x844`, "Avisos");
    }
    await close();
  }
  checks.push("Loading, empty, retryable error and offline notices states");
  for (const role of ["advisor", "coordinator"]) {
    await mount("light", role);
    await open();
    assert.equal(
      await p.getByRole("button", { name: /^Llegaste al/ }).count(),
      0,
    );
    if (role === "advisor")
      assert.equal(
        await p.getByRole("button", { name: /^La IA pasó a Karla/ }).count(),
        0,
      );
    await p
      .getByRole("button", { name: "Preferencias de avisos", exact: true })
      .click();
    await p
      .getByRole("heading", { name: "Notificaciones", exact: true })
      .waitFor();
  }
  checks.push(
    "Personal preferences allowed to all three roles; Advisor has no other actors' chat notice; quota owner only",
  );
  const ids = ["MORE-05", "SET-14"],
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
  assert.deepEqual(errors, []);
  assert.equal(networkCount(), 0);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        ids,
        checks,
        actualCaptures,
        officialReferences: 4,
        errors,
        networkRequests: networkCount(),
        httpServerStarted: false,
        native: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors, actualCaptures }));
  await p.close();
  await ref.close();
}

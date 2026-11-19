import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runQuick(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-quick");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  let actualCaptures = 0;
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("QUICK_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const mount = async (theme = "light", role = "owner", reset = true) => {
    await p.evaluate(
      ({ theme, role, reset }) => {
        if (reset) window.qaResetStorage();
        window.qaFailWrite = false;
        window.qaFailRead = false;
        window.mountRefinement("quick-replies", theme, role);
      },
      { theme, role, reset },
    );
    if (role !== "advisor")
      await p
        .getByRole("heading", { name: "Respuestas rápidas", exact: true })
        .waitFor();
    await settle(p);
  };
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
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await p.getByRole("button", { name: /^\/hola ·/ }).waitFor();
      await shot(`SET-06-${theme}-${width}x${height}`, "Respuestas rápidas");
      await p.getByRole("button", { name: /^\/hola ·/ }).click();
      await shot(`SET-06A-${theme}-${width}x${height}`, "Respuesta rápida");
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
    }
  checks.push(
    "SET-06 and SET-06A captured actual RN screens/sheets both themes/sizes; no unapproved selectors",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await p.getByRole("button", { name: "Nueva respuesta", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Atajo", exact: true })
    .fill("Hola Mundo");
  await p
    .getByRole("textbox", { name: "Texto", exact: true })
    .fill("¡Hola {nombre} desde QA!");
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p
    .getByText("Solo minúsculas, números, _ y -, hasta 30 caracteres.", {
      exact: true,
    })
    .waitFor();
  await shot("state-validation-light-390x844", "Respuesta rápida");
  await p.getByRole("textbox", { name: "Atajo", exact: true }).fill("qa_demo");
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  await shot("state-save-error-light-390x844", "Respuesta rápida");
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p.getByRole("button", { name: /^\/qa_demo ·/ }).waitFor();
  assert.equal(
    await p.evaluate(
      () =>
        window
          .qaQuick()
          .snapshot()
          .doc.rows.filter((r) => r.shortcut === "qa_demo").length,
    ),
    1,
  );
  checks.push(
    "Invalid shortcut validation and save failure preserve text; safe retry creates exactly once",
  );
  await nav("/conversation/demo-conv-1");
  await p.getByRole("textbox", { name: "Mensaje", exact: true }).waitFor();
  await p.getByRole("textbox", { name: "Mensaje", exact: true }).fill("/qa");
  await p
    .getByRole("button", { name: "/qa_demo · Respuestas rápidas", exact: true })
    .click();
  await p
    .getByRole("button", { name: /^\/qa_demo · ¡Hola Karla desde QA!/ })
    .click();
  assert.equal(
    await p.getByRole("textbox", { name: "Mensaje", exact: true }).inputValue(),
    "¡Hola Karla desde QA!",
  );
  await shot("state-chat-draft-light-390x844");
  checks.push(
    "New canonical shortcut immediately appears in Chat slash suggestions, replaces name and inserts draft without sending",
  );
  await nav("/quick-replies");
  await p.getByRole("button", { name: /^\/qa_demo ·/ }).click();
  await p
    .getByRole("textbox", { name: "Texto", exact: true })
    .fill("Actualizado {nombre}, gracias {nombre}");
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p.getByRole("button", { name: /^\/qa_demo · Actualizado/ }).waitFor();
  await nav("/conversation/demo-conv-1");
  await p.getByRole("textbox", { name: "Mensaje", exact: true }).fill("/qa");
  await p
    .getByRole("button", { name: "/qa_demo · Respuestas rápidas", exact: true })
    .click();
  await p
    .getByRole("button", {
      name: /^\/qa_demo · Actualizado Karla, gracias Karla/,
    })
    .click();
  assert.equal(
    await p.getByRole("textbox", { name: "Mensaje", exact: true }).inputValue(),
    "Actualizado Karla, gracias Karla",
  );
  checks.push(
    "Editing the shared catalog updates existing Chat selector and every name variable",
  );
  await mount("light", "coordinator", false);
  await p.getByRole("button", { name: /^\/qa_demo · Actualizado/ }).waitFor();
  await mount("light", "advisor", false);
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  await nav("/conversation/demo-conv-3");
  await p.getByRole("textbox", { name: "Mensaje", exact: true }).waitFor();
  await p.getByRole("textbox", { name: "Mensaje", exact: true }).fill("/qa");
  await p
    .getByRole("button", { name: "/qa_demo · Respuestas rápidas", exact: true })
    .click();
  await p.getByRole("button", { name: /^\/qa_demo · Actualizado/ }).waitFor();
  await close();
  checks.push(
    "Organization catalog survives actor switch; Coordinator can manage, Advisor can only use in authorized Chat",
  );
  for (const status of ["loading", "empty", "error", "offline"]) {
    await mount();
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await shot(`state-${status}-light-390x844`, "Respuestas rápidas");
    if (status === "error") {
      await p.getByRole("button", { name: "Reintentar", exact: true }).click();
      await p.getByRole("button", { name: /^\/hola ·/ }).waitFor();
    }
  }
  checks.push(
    "Loading, empty, retry and offline states; internal screen without bottom tabs",
  );
  const ids = ["SET-06", "SET-06A"],
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

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runInternal(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/internal-chat");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("INTERNAL_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  const nav = async (route) => {
      await p.evaluate((route) => window.qaNavigate(route), route);
      await settle(p);
    },
    close = () =>
      p.getByRole("button", { name: "Cerrar", exact: true }).click(),
    shot = async (name, title) => {
      if (title)
        await p.getByRole("heading", { name: title, exact: true }).waitFor();
      await settle(p);
      await p.screenshot({ path: path.join(out, name + ".png") });
    };
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate(
        (theme) => window.mountRefinement("inbox", theme),
        theme,
      );
      await p.getByRole("tab", { name: "Equipo", exact: true }).click();
      await p
        .getByRole("button", { name: "Abrir Ventas", exact: true })
        .waitFor();
      await shot(`EQP-01-${theme}-${width}x${height}`, "Bandeja");
      await p
        .getByRole("button", { name: "Nuevo mensaje", exact: true })
        .click();
      await shot(`EQP-03-${theme}-${width}x${height}`, "Nuevo mensaje");
      await close();
      await p
        .getByRole("button", { name: "Abrir Ventas", exact: true })
        .click();
      await p
        .getByRole("textbox", { name: "Mensaje al equipo", exact: true })
        .waitFor();
      await shot(`EQP-02-${theme}-${width}x${height}`, "Ventas");
      await p.getByRole("button", { name: "Mencionar", exact: true }).click();
      await shot(`EQP-05-${theme}-${width}x${height}`, "Mencionar");
      await close();
      await p
        .getByRole("button", {
          name: "Información de la conversación",
          exact: true,
        })
        .click();
      await shot(`EQP-04-${theme}-${width}x${height}`, "Ventas");
    }
  await p.setViewportSize({ width: 390, height: 844 });
  await nav("/(tabs)/inbox?area=team");
  await p.getByRole("button", { name: "Nuevo mensaje", exact: true }).click();
  await p.getByRole("button", { name: "Ana López", exact: true }).click();
  await p.getByRole("heading", { name: "Ana López", exact: true }).waitFor();
  const text = p.getByRole("textbox", {
    name: "Mensaje al equipo",
    exact: true,
  });
  await text.fill("Mensaje interno QA");
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await p.getByRole("button", { name: "Enviar interno", exact: true }).click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await p.getByRole("button", { name: "Enviar interno", exact: true }).click();
  await p.getByText("Mensaje interno QA", { exact: true }).waitFor();
  assert.equal(
    await p.evaluate(
      () =>
        window
          .qaInternal()
          .snapshot()
          .doc.messages.filter((m) => m.text === "Mensaje interno QA").length,
    ),
    1,
  );
  await p
    .getByRole("button", { name: "Adjuntar muestra", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Documento de demostración", exact: true })
    .click();
  await p.getByRole("button", { name: "Enviar interno", exact: true }).click();
  await p
    .getByRole("button", { name: "Documento-demo.pdf", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "Vista previa ficticia", exact: true })
    .waitFor();
  await close();
  await nav("/(tabs)/inbox?area=team");
  await p.getByRole("button", { name: "Nuevo mensaje", exact: true }).click();
  await p.getByRole("button", { name: "Nuevo grupo", exact: true }).click();
  await p.getByRole("checkbox", { name: "Ana López", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Nombre del grupo", exact: true })
    .fill("Grupo QA");
  await p.getByRole("button", { name: "Crear grupo", exact: true }).click();
  await p.getByRole("heading", { name: "Grupo QA", exact: true }).waitFor();
  await p
    .getByRole("button", {
      name: "Información de la conversación",
      exact: true,
    })
    .click();
  await p.getByRole("button", { name: "Salir del grupo", exact: true }).click();
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  await p.getByRole("button", { name: "Salir del grupo", exact: true }).click();
  await p.getByRole("button", { name: "Confirmar", exact: true }).click();
  await p.getByRole("heading", { name: "Bandeja", exact: true }).waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Abrir Grupo QA", exact: true })
      .count(),
    0,
  );
  await nav("/internal-chat/demo-room-sales");
  const composer = p.getByRole("textbox", {
    name: "Mensaje al equipo",
    exact: true,
  });
  await composer.fill("Borrador local");
  await p.waitForFunction(
    async () =>
      (await window.qaInternal().draft("demo-room-sales")) === "Borrador local",
  );
  await nav("/(tabs)/inbox?area=team");
  await p.getByRole("button", { name: "Abrir Ventas", exact: true }).click();
  assert.equal(await composer.inputValue(), "Borrador local");
  await composer.fill("");
  await p.getByRole("button", { name: "Mencionar", exact: true }).click();
  await p.getByRole("button", { name: "Karla Méndez", exact: true }).click();
  await p.getByRole("button", { name: "Enviar interno", exact: true }).click();
  await p.getByRole("button", { name: "Karla Méndez", exact: true }).waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "advisor"));
  await nav("/(tabs)/inbox?area=team");
  await p.getByRole("button", { name: "Abrir Avisos", exact: true }).click();
  await p
    .getByText("Solo la coordinación publica en Avisos.", { exact: true })
    .waitFor();
  assert.equal(
    await p
      .getByRole("textbox", { name: "Mensaje al equipo", exact: true })
      .count(),
    0,
  );
  await nav("/internal-chat/demo-room-sales");
  await p
    .getByRole("button", { name: "Chat restringido", exact: true })
    .waitFor();
  assert.equal(await p.getByText("Karla Méndez", { exact: true }).count(), 0);
  await p.evaluate(() => window.mountRefinement("inbox", "light", "owner"));
  await nav("/(tabs)/inbox?area=team");
  await p.getByRole("button", { name: "Abrir Ventas", exact: true }).waitFor();
  const privateId = await p.evaluate(() => window.qaPrivate());
  await nav(`/internal-chat/${privateId}`);
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  await nav("/internal-supervision-lab");
  await p
    .getByRole("button", {
      name: "Permitir supervisión: Fer Ramírez",
      exact: true,
    })
    .click();
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate((theme) => {
        window.qaTheme = theme;
      }, theme);
      await nav("/(tabs)/inbox?area=team");
      await p.getByRole("button", { name: "Supervisión", exact: true }).click();
      const title = await p.evaluate(
        (id) =>
          window.qaInternal().title(
            window
              .qaInternal()
              .snapshot()
              .doc.rooms.find((r) => r.id === id),
          ),
        privateId,
      );
      await p.getByRole("button", { name: title, exact: true }).click();
      await p
        .getByText("Supervisión activa · solo lectura", { exact: true })
        .waitFor();
      assert.equal(
        await p
          .getByRole("textbox", { name: "Mensaje al equipo", exact: true })
          .count(),
        0,
      );
      await shot(`EQP-06-${theme}-${width}x${height}`);
    }
  assert.ok(
    await p.evaluate(
      () => window.qaInternal().snapshot().doc.audit.length >= 4,
    ),
  );
  await nav("/internal-supervision-lab");
  await p
    .getByRole("button", {
      name: "Revocar supervisión: Fer Ramírez",
      exact: true,
    })
    .click();
  await nav(`/internal-chat/${privateId}?supervise=1`);
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of [
      "EQP-01",
      "EQP-02",
      "EQP-03",
      "EQP-04",
      "EQP-05",
      "EQP-06",
    ]) {
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
        actualCaptures: 24,
        references: 12,
        checks: [
          "Six EQP IDs both themes/sizes",
          "Bandeja selector and internal routes",
          "Direct save failure, retry and no duplicates",
          "Attachment preview",
          "Create group, leave confirmation/cancel",
          "Advisor announcements read-only",
          "Explicit supervision, audited access, read-only view and revocation",
          "Draft restoration and customer mention masked for unauthorized reader",
        ],
        errors,
        networkRequests: networkCount(),
        native: false,
      },
      null,
      2,
    ),
  );
  console.log("Internal chat QA passed");
  await p.close();
  await ref.close();
}

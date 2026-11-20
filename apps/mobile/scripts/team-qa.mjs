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
  const nav = async (route) => {
    await p.evaluate((route) => window.qaNavigate(route), route);
    await settle(p);
  };
  await p.setViewportSize({ width: 390, height: 844 });
  await nav("/team");
  await p.getByRole("button", { name: "Invitar persona", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Nombre", exact: true })
    .fill("Persona QA");
  await p
    .getByRole("textbox", { name: "Correo", exact: true })
    .fill("qa@example.test");
  await p.evaluate(() => {
    window.qaFailWrite = true;
  });
  await p.getByRole("button", { name: "Crear enlace", exact: true }).click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  await p.evaluate(() => {
    window.qaFailWrite = false;
  });
  await p.getByRole("button", { name: "Crear enlace", exact: true }).click();
  await p.getByText(/Invitación local creada:/).waitFor();
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  const first = await p.evaluate(
    () => window.qaTeam().snapshot().doc.invitations.at(-1).id,
  );
  await nav("/team-lab");
  await p
    .getByRole("button", { name: `Vencer muestra ${first}`, exact: true })
    .click();
  await p.waitForFunction(
    (id) => window.qaTeam().invitationState(id) === "expired",
    first,
  );
  await nav("/team");
  await p.getByRole("button", { name: /Persona QA · Asesor/ }).click();
  await p
    .getByRole("button", { name: "Reemitir invitación", exact: true })
    .click();
  const second = await p.evaluate(
    () => window.qaTeam().snapshot().doc.invitations.at(-1).id,
  );
  assert.notEqual(first, second);
  await nav("/team-lab");
  await p
    .getByRole("button", { name: `Aceptar muestra ${second}`, exact: true })
    .click();
  await p.waitForFunction(
    (id) => window.qaTeam().invitationState(id) === "accepted",
    second,
  );
  await nav("/(tabs)/crm");
  await p.waitForFunction(() => !!window.qaModel());
  await p.evaluate(() => {
    window.qaModel().patch({ contactId: "demo-conv-1" });
    window.qaActions.onLayer("CRM-02");
  });
  await p.getByRole("button", { name: /^Asesor ·/ }).click();
  await p.getByRole("radio", { name: "Persona QA", exact: true }).click();
  await nav("/contact/demo-conv-1");
  await p.getByRole("button", { name: /^Asignado ·/ }).click();
  await p.getByRole("radio", { name: /Persona QA/ }).click();
  await p.getByRole("button", { name: /^Asignado · Persona QA/ }).waitFor();
  await nav("/usage");
  await p.getByText("4 de 5 personas", { exact: true }).waitFor();
  await nav("/team");
  await p.getByRole("button", { name: /Persona QA · Asesor/ }).click();
  await p
    .getByRole("button", { name: "Restablecer acceso ficticio", exact: true })
    .click();
  assert.equal(
    await p.evaluate(
      () =>
        window
          .qaTeam()
          .snapshot()
          .doc.members.find((m) => m.email === "qa@example.test").resetCount,
    ),
    1,
  );
  await p.getByRole("button", { name: /Persona QA · Asesor/ }).click();
  await p
    .getByRole("button", { name: "Desactivar acceso", exact: true })
    .click();
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  await p
    .getByRole("button", { name: "Desactivar acceso", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Confirmar desactivación", exact: true })
    .click();
  await p.waitForFunction(
    () =>
      !window
        .qaTeam()
        .snapshot()
        .doc.members.find((m) => m.email === "qa@example.test").active,
  );
  await nav("/contact/demo-conv-1");
  await p.getByRole("button", { name: /^Asignado · Persona QA/ }).waitFor();
  await p.getByRole("button", { name: /^Asignado ·/ }).click();
  assert.equal(await p.getByRole("radio", { name: /Persona QA/ }).count(), 0);
  await p.getByRole("button", { name: "Cerrar", exact: true }).click();
  await nav("/team");
  await p.getByRole("button", { name: /Fer Ramírez · Propietario/ }).click();
  await p
    .getByRole("button", { name: "Desactivar acceso", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Confirmar desactivación", exact: true })
    .click();
  await p
    .getByText("No puedes quitar al último propietario.", { exact: true })
    .waitFor();
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  await p.getByRole("button", { name: "Cerrar", exact: true }).click();
  await p.evaluate(async () => {
    window.qaFailRead = true;
    await window.qaTeam().reload();
  });
  await p.getByRole("button", { name: "Reintentar", exact: true }).waitFor();
  await p.evaluate(() => {
    window.qaFailRead = false;
  });
  await p.getByRole("button", { name: "Reintentar", exact: true }).click();
  await p
    .getByRole("button", { name: "Invitar persona", exact: true })
    .waitFor();
  for (const role of ["coordinator", "advisor"]) {
    await p.evaluate(
      (role) => window.mountRefinement("team", "light", role),
      role,
    );
    await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  }
  await p.evaluate(() => window.mountRefinement("team", "light", "owner"));
  await p
    .getByRole("button", { name: "Invitar persona", exact: true })
    .waitFor();
  await p.evaluate(async () => {
    const store = window.qaTeam();
    for (const m of store
      .snapshot()
      .doc.members.filter((m) => m.active && m.id !== "demo-owner"))
      await store.update(
        "demo-owner",
        m.id,
        {
          role: m.role,
          active: false,
          receiveNew: m.receiveNew,
          expected: m.revision,
        },
        "qa-empty-" + m.id,
      );
  });
  await p.getByText("Aún eres solo tú", { exact: true }).waitFor();
  await settle(p);
  await p.screenshot({ path: path.join(out, "state-empty-light-390x844.png") });
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
        actualCaptures: 13,
        errors,
        networkRequests: networkCount(),
        native: false,
        complete: true,
        checks:
          "Invite failure/retry, expiration/reissue/acceptance, contact assignment, Usage seats, reset, confirmation/cancel, historical name, last owner, storage read recovery",
      },
      null,
      2,
    ),
  );
  console.log("Team end-to-end checks and captures passed");
  await p.close();
}

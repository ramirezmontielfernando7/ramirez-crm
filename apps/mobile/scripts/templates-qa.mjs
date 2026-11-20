import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runTemplates(context, html, root, requests) {
  const out = path.join(root, "artifacts/templates");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("TEMPLATE_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  const nav = async (r) => {
      await p.evaluate((r) => window.qaNavigate(r), r);
      await settle(p);
    },
    button = (name) => p.getByRole("button", { name, exact: true }),
    field = (name) => p.getByRole("textbox", { name, exact: true });
  await p.evaluate(() => window.mountRefinement("inbox", "light"));
  await settle(p);
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await p.evaluate((t) => (window.qaTheme = t), theme);
      for (const [id, route, title] of [
        ["MKT-20", "/(tabs)/marketing?section=templates", "Marketing"],
        ["MKT-21", "/template-detail?id=cotizacion_lista", "cotizacion_lista"],
        ["MKT-22", "/template-new", "Nueva plantilla"],
      ]) {
        await nav(route);
        await p.getByRole("heading", { name: title, exact: true }).waitFor();
        await settle(p);
        await p.screenshot({
          path: path.join(out, `${id}-${theme}-${width}x${height}.png`),
        });
      }
    }
  await field("Nombre").fill("MAL NOMBRE");
  await button("Enviar a revisión").click();
  await p
    .getByText("Nombre en minúsculas, números y guion bajo (3–64).", {
      exact: true,
    })
    .waitFor();
  await field("Nombre").fill("seguimiento_qa");
  await field("Cuerpo").fill("Hola {{1}}, tu consulta ficticia está lista.");
  await p.evaluate(() => (window.qaFailWrite = true));
  await button("Enviar a revisión").click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  await p.evaluate(() => (window.qaFailWrite = false));
  await button("Enviar a revisión").click();
  await p
    .getByRole("heading", { name: "seguimiento_qa", exact: true })
    .waitFor();
  await p.getByText("En revisión", { exact: true }).waitFor();
  await nav("/template-lab");
  await button("Rechazada · seguimiento_qa").click();
  await nav("/template-detail?id=seguimiento_qa");
  await button("Corregir y reenviar").click();
  await field("Cuerpo").fill("Hola {{1}}, confirmamos tu consulta de prueba.");
  await button("Enviar a revisión").click();
  await p.getByText("En revisión", { exact: true }).waitFor();
  await nav("/template-lab");
  await button("Aprobada · seguimiento_qa").click();
  await p.waitForFunction(
    () => window.qaTemplates().get("seguimiento_qa").status === "approved",
  );
  await nav("/conversation/demo-conv-7");
  await button("Enviar plantilla").click();
  await button("seguimiento_qa").click();
  await button("Enviar plantilla de prueba").click();
  await p
    .getByText(/confirmamos tu consulta de prueba\./)
    .first()
    .waitFor();
  await nav("/template-lab");
  await button("Pausada · seguimiento_qa").click();
  await p.waitForFunction(
    () => window.qaTemplates().get("seguimiento_qa").status === "paused",
  );
  await nav("/(tabs)/marketing?section=templates");
  await button("seguimiento_qa").click();
  await p
    .getByText("Plantilla pausada · no puede enviarse en Chat.", {
      exact: true,
    })
    .waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "advisor"));
  await settle(p);
  await nav("/(tabs)/marketing?section=templates");
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "owner"));
  await settle(p);
  await nav("/template-detail?id=seguimiento_qa");
  await p
    .getByText("Plantilla pausada · no puede enviarse en Chat.", {
      exact: true,
    })
    .waitFor();
  await nav("/(tabs)/marketing?section=templates");
  await p.evaluate(() => (window.qaFailRead = true));
  await button("Sincronizar plantillas").click();
  await button("Reintentar").waitFor();
  await p.evaluate(() => (window.qaFailRead = false));
  await button("Reintentar").click();
  await button("seguimiento_qa").waitFor();
  const ref = await context.newPage();
  await ref.setContent(
    fs.readFileSync(
      path.join(root, "docs/reference/dashfort-mobile-prototipo.html"),
      "utf8",
    ),
  );
  await ref.waitForFunction(() => typeof go === "function");
  for (const theme of ["light", "dark"])
    for (const id of ["MKT-20", "MKT-21", "MKT-22"]) {
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
    JSON.stringify(
      {
        captures: 12,
        references: 6,
        errors,
        requests: requests(),
        native: false,
        checks: [
          "Create/validate/failure/retry",
          "Reject/correct/approve",
          "Shared Chat template and pause",
          "Role isolation and restore",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Templates QA passed");
  await p.close();
  await ref.close();
}

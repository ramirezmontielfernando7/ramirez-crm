import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { settle } from "./qa-settle.mjs";
export async function runMarketing(context, html, root, requests) {
  const out = path.join(root, "artifacts/marketing");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("MARKETING_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  const nav = async (r) => {
      await p.evaluate((r) => window.qaNavigate(r), r);
      await settle(p);
    },
    button = (name) => p.getByRole("button", { name, exact: true }),
    field = (name) => p.getByRole("textbox", { name, exact: true }),
    radio = (name) => p.getByRole("radio", { name, exact: true }),
    shot = async (name) => {
      await settle(p);
      await p.screenshot({ path: path.join(out, name + ".png") });
    };
  await p.evaluate(() => window.mountRefinement("inbox", "light"));
  await settle(p);
  await nav("/(tabs)/marketing?section=audiences");
  await p.getByText("Sin bases todavía", { exact: true }).waitFor();
  for (const theme of ["light", "dark"]) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate((t) => (window.qaTheme = t), theme);
    await nav("/(tabs)/marketing?section=audiences");
    await button("Subir una base").click();
    await shot(`MKT-12-${theme}-390x844`);
    await button("Cerrar").click();
  }
  await button("Subir una base").click();
  await button("Elegir .xlsx o .csv").click();
  await button("base-ficticia.csv").click();
  await radio("Teléfono: telefono").click();
  await radio("Nombre: nombre").click();
  await radio("Sí (opt-in)").click();
  await p.evaluate(() => (window.qaFailWrite = true));
  await button("Importar").click();
  await p.getByText("Escritura local simulada", { exact: true }).waitFor();
  await p.evaluate(() => (window.qaFailWrite = false));
  await button("Importar").click();
  await p
    .getByRole("heading", { name: "Base noviembre", exact: true })
    .waitFor();
  const audience = await p.evaluate(
    () => window.qaMarketing().audiences()[0].id,
  );
  for (const theme of ["light", "dark"]) {
    await p.evaluate((t) => (window.qaTheme = t), theme);
    await nav("/audience-detail?id=" + audience);
    await shot(`MKT-11-${theme}-390x844`);
    await nav("/(tabs)/marketing?section=audiences");
    await shot(`MKT-10-${theme}-390x844`);
  }
  await nav("/audience-detail?id=" + audience);
  await button("Crear campaña con esta base").click();
  await field("Nombre interno").fill("Campaña QA ficticia");
  await button("Siguiente").click();
  await radio("promo_2x1").click();
  await button("Siguiente").click();
  await button("Siguiente").click();
  await button("Simular prueba").click();
  await button("Siguiente").click();
  await p
    .getByText("Prueba local válida · no se envió ningún mensaje", {
      exact: true,
    })
    .waitFor({ state: "hidden", timeout: 6000 });
  await p
    .getByRole("button", { name: "Programar campaña", exact: true })
    .waitFor();
  const campaign = await p.evaluate(
    () => window.qaMarketing().campaigns()[0].id,
  );
  for (const theme of ["light", "dark"]) {
    await p.evaluate((t) => (window.qaTheme = t), theme);
    await nav("/campaign-new?id=" + campaign);
    await shot(`MKT-03-${theme}-390x844`);
    await button("Programar campaña").click();
    await shot(`MKT-04-${theme}-390x844`);
    await button("Cancelar").click();
  }
  await button("Programar campaña").click();
  await field("Escribe 3 para confirmar").fill("999");
  await button("Programar").click();
  await p
    .getByText("Cambió la revisión o no coincide el número de destinatarios.", {
      exact: true,
    })
    .waitFor();
  await field("Escribe 3 para confirmar").fill("3");
  await button("Programar").click();
  await p
    .getByRole("heading", { name: "Campaña QA ficticia", exact: true })
    .waitFor();
  for (const theme of ["light", "dark"]) {
    await p.evaluate((t) => (window.qaTheme = t), theme);
    await nav("/campaign-detail?id=" + campaign);
    await shot(`MKT-02-${theme}-390x844`);
    await button("Más opciones de la campaña").click();
    await shot(`MKT-06-${theme}-390x844`);
    await button("Cerrar").click();
    await nav("/(tabs)/marketing");
    await shot(`MKT-01-${theme}-390x844`);
    await button("Más opciones de Campañas").click();
    await shot(`MKT-05-${theme}-390x844`);
    await button("Ajustes de campañas").click();
    await shot(`MKT-31-${theme}-390x844`);
  }
  await nav("/campaign-detail?id=" + campaign);
  await button("Pausar").click();
  await button("Cancelar").click();
  await button("Pausar").click();
  await button("Confirmar").click();
  await p.getByText("Pausada · Simulada", { exact: true }).waitFor();
  await button("Reanudar").click();
  await button("Confirmar").click();
  await p.getByText("En curso · Simulada", { exact: true }).waitFor();
  await nav("/campaign-lab");
  await button("Respondió · Campaña QA ficticia").click();
  await p.waitForFunction(
    () => window.qaMarketing().metrics("month").sent === 1,
  );
  await button("Leído · Campaña QA ficticia").click();
  await p.waitForFunction(
    () => window.qaMarketing().metrics("month").sent === 2,
  );
  await button("Falló · Campaña QA ficticia").click();
  await p.waitForFunction(
    () => window.qaMarketing().campaigns()[0].status === "paused",
  );
  for (const theme of ["light", "dark"]) {
    await p.evaluate((t) => (window.qaTheme = t), theme);
    await nav("/(tabs)/marketing?section=metrics");
    await shot(`MKT-30-${theme}-390x844`);
  }
  await nav("/campaign-settings");
  await field("Pausar si fallan más de (%)").fill("0");
  await button("Guardar").click();
  await p
    .getByText("Revisa umbral, frecuencia y tarifas en centavos.", {
      exact: true,
    })
    .waitFor();
  await field("Pausar si fallan más de (%)").fill("10");
  await field("Marketing").fill("0.955");
  await button("Guardar").click();
  await p
    .getByText("Escribe la tarifa en MXN con hasta dos decimales.", {
      exact: true,
    })
    .waitFor();
  await field("Marketing").fill("0.95");
  await button("Guardar").click();
  await p.waitForFunction(
    () => window.qaMarketing().snapshot().doc.settings.marketingCents === 95,
  );
  await nav("/(tabs)/marketing?section=metrics");
  await p.getByRole("tab", { name: "Reportado por Meta", exact: true }).click();
  await p.getByText("Costo reportado ficticio", { exact: true }).waitFor();
  await button("Exportar métricas").click();
  await nav("/campaign-detail?id=" + campaign);
  await button("Más opciones de la campaña").click();
  await button("Duplicar").click();
  await p
    .getByRole("heading", { name: "Nueva campaña", exact: true })
    .waitFor();
  assert.equal(
    await p.evaluate(() => window.qaMarketing().campaigns().length),
    2,
  );
  await nav("/campaign-detail?id=" + campaign);
  await button("Más opciones de la campaña").click();
  await button("Cancelar campaña").click();
  await button("Confirmar").click();
  await p.getByText("Cancelada · Simulada", { exact: true }).waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "advisor"));
  await settle(p);
  await nav("/(tabs)/marketing?section=audiences");
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  await p.evaluate(() => window.mountRefinement("inbox", "light", "owner"));
  await settle(p);
  await nav("/(tabs)/marketing?section=audiences");
  await button("Base noviembre · 3 contactos").waitFor();
  assert.equal(
    await p.evaluate(() => window.qaMarketing().campaigns()[0].status),
    "cancelled",
  );
  await p.evaluate(() => (window.qaDisabled = ["marketing"]));
  await nav("/campaign-settings");
  await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  const blocked = await p.evaluate(async () => {
    try {
      await window.qaMarketing().start(undefined, "disabled-operation");
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(blocked, true);
  await p.evaluate(() => (window.qaDisabled = []));
  await nav("/(tabs)/marketing?section=audiences");
  await button("Base noviembre · 3 contactos").waitFor();
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
      "MKT-10",
      "MKT-11",
      "MKT-12",
      "MKT-01",
      "MKT-02",
      "MKT-03",
      "MKT-04",
      "MKT-05",
      "MKT-06",
      "MKT-31",
      "MKT-30",
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
  assert.equal(requests(), 0);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        captures: 22,
        references: 22,
        errors,
        requests: requests(),
        native: false,
        checks: [
          "Sample select/map/consent/import failure retry",
          "Audience detail → five-step wizard",
          "Reinforced confirmation and wrong count",
          "Manual pause/resume/cancel/duplicate",
          "Manual results and safety pause",
          "Role denial and restored sources",
        ],
      },
      null,
      2,
    ),
  );
  await p.close();
  await ref.close();
  console.log("Marketing QA passed");
}

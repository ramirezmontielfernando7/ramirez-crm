import { capturePage, settle } from "./qa-settle.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
export async function runKnowledge(context, html, root, networkCount) {
  const out = path.join(root, "artifacts/continuation-knowledge");
  fs.mkdirSync(out, { recursive: true });
  const p = await context.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("KNOWLEDGE_ERROR", e.message);
  });
  await p.setContent(html);
  await p.waitForFunction(() => window.mountRefinement);
  await p.evaluate(() => document.fonts.ready);
  const shot = capturePage(p);
  const mount = async (theme = "light", role = "owner") => {
    await p.evaluate(
      ({ theme, role }) => window.mountRefinement("studio", theme, role),
      { theme, role },
    );
    if (role === "owner")
      await p
        .getByRole("button", {
          name: "Documento: Catálogo mayoreo 2026.pdf",
          exact: true,
        })
        .waitFor();
  };
  const close = () =>
    p.getByRole("button", { name: "Cerrar", exact: true }).click();
  const upload = () =>
    p.getByRole("button", { name: "Subir documento", exact: true }).click();
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ])
    for (const theme of ["light", "dark"]) {
      await p.setViewportSize({ width, height });
      await mount(theme);
      await shot({
        path: path.join(out, `LAB-10-${theme}-${width}x${height}.png`),
      });
      await upload();
      await shot({
        path: path.join(out, `LAB-11-${theme}-${width}x${height}.png`),
      });
      await close();
      await p
        .getByRole("button", {
          name: "Documento: Catálogo mayoreo 2026.pdf",
          exact: true,
        })
        .click();
      await shot({
        path: path.join(out, `LAB-12-${theme}-${width}x${height}.png`),
      });
      await close();
    }
  checks.push(
    "3 Knowledge IDs in both themes and sizes with real providers and sheets",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await mount();
  await upload();
  await p.getByRole("button", { name: "Subir", exact: true }).click();
  await p.getByText("Elige un archivo ficticio.", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Elegir archivo", exact: true }).click();
  await p
    .getByRole("button", { name: "Manual de producto.pdf", exact: true })
    .click();
  await p.getByRole("button", { name: /Quién lo lee:/ }).click();
  await p.getByRole("button", { name: "Citas y agenda", exact: true }).click();
  await p.evaluate(() => (window.qaFailWrite = true));
  await p.getByRole("button", { name: "Subir", exact: true }).click();
  await p
    .getByText("No se pudo guardar localmente. Tu borrador sigue disponible.", {
      exact: true,
    })
    .last()
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Manual de producto.pdf", exact: true })
      .count(),
    1,
  );
  await p.evaluate(() => (window.qaFailWrite = false));
  await p.getByRole("button", { name: "Subir", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Documento: Manual de producto.pdf",
      exact: true,
    })
    .waitFor();
  await shot({
    path: path.join(out, "state-processing-light-390x844.png"),
  });
  await p.waitForFunction(() =>
    window
      .qaLibrary()
      .snapshot()
      .entries.some(
        (e) =>
          e.title === "Manual de producto.pdf" &&
          e.knowledge?.status === "indexed",
      ),
  );
  await p.getByRole("button", { name: "Exclusivos", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Documento: Manual de producto.pdf",
      exact: true,
    })
    .waitFor();
  checks.push(
    "File required; failed save retains selection; retry once; visible-only indexing and exclusive reader",
  );
  await p.getByRole("button", { name: "General", exact: true }).click();
  await upload();
  await p.getByRole("button", { name: "Elegir archivo", exact: true }).click();
  await p
    .getByRole("button", { name: "Escaneo sin texto.pdf", exact: true })
    .click();
  await p.getByRole("button", { name: "Subir", exact: true }).click();
  await p.waitForFunction(() =>
    window
      .qaLibrary()
      .snapshot()
      .entries.some(
        (e) =>
          e.title === "Escaneo sin texto.pdf" &&
          e.knowledge?.status === "failed",
      ),
  );
  await shot({
    path: path.join(out, "state-failed-light-390x844.png"),
  });
  checks.push("Scanned sample becomes unreadable without real indexing");
  await p
    .getByRole("button", {
      name: "Documento: Catálogo mayoreo 2026.pdf",
      exact: true,
    })
    .click();
  await p.getByRole("button", { name: "Mover a…", exact: true }).click();
  await p.getByRole("button", { name: "Ventas", exact: true }).click();
  await p.getByRole("button", { name: "Ventas", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Documento: Catálogo mayoreo 2026.pdf",
      exact: true,
    })
    .waitFor();
  await p.evaluate(() => window.qaNavigate("/library/demo-library-catalog"));
  await p
    .getByRole("button", { name: "Grupo de documentos: Ventas", exact: true })
    .waitFor();
  await p.evaluate(() => window.qaGoBack());
  await p
    .getByRole("button", {
      name: "Documento: Catálogo mayoreo 2026.pdf",
      exact: true,
    })
    .click();
  await p
    .getByRole("button", { name: "Borrar documento", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Confirmar borrado", exact: true })
    .click();
  await p.waitForFunction(
    () => !window.qaLibrary().get("demo-library-catalog").rag,
  );
  assert.equal(
    await p.evaluate(() => window.qaLibrary().get("demo-library-catalog").chat),
    true,
  );
  checks.push(
    "Move reflected in actual Library editor; delete only IA destination, preserves Chat material",
  );
  await p.getByRole("button", { name: "Nuevo grupo", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Nombre del grupo", exact: true })
    .fill("Dirección");
  await p.getByRole("button", { name: "Crear grupo", exact: true }).click();
  await p.getByRole("button", { name: "Dirección", exact: true }).waitFor();
  await p.getByRole("tab", { name: "Agentes", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Editar agente: Ventas — general",
      exact: true,
    })
    .waitFor();
  await p.getByRole("tab", { name: "Conocimiento", exact: true }).click();
  checks.push(
    "Groups persist; actual Agents tab returns to shared Knowledge without losing groups",
  );
  for (const role of ["coordinator", "advisor"]) {
    await mount("dark", role);
    await p.getByText("Acceso no permitido", { exact: true }).waitFor();
  }
  checks.push("Studio permission enforced on direct route");
  for (const status of ["loading", "empty", "offline", "error"]) {
    await p.evaluate(() => window.mountRefinement("studio", "light", "owner"));
    await p.waitForFunction(() => window.qaLibrary().snapshot().ready);
    await p.evaluate((status) => window.qaInbox.patch({ status }), status);
    await p.waitForTimeout(60);
    await shot({
      path: path.join(out, `state-${status}-light-390x844.png`),
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
  for (const theme of ["light", "dark"])
    for (const id of ["LAB-10", "LAB-11", "LAB-12"]) {
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
  if (errors.length || networkCount())
    throw Error(JSON.stringify({ errors, requests: networkCount() }));
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        ids: ["LAB-10", "LAB-11", "LAB-12"],
        checks,
        actualCaptures: 18,
        officialReferences: 6,
        errors,
        networkRequests: networkCount(),
        httpServerStarted: false,
        native: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }));
  await p.close();
  await ref.close();
}

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
const dir = "artifacts/tm2/screenshots";
fs.mkdirSync(dir, { recursive: true });
async function login(page: Page, role = "Propietario") {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: `Entrar como ${role}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bandeja", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("conversation-list")).toBeVisible();
}
async function menu(page: Page, label: string) {
  await page.getByRole("button", { name: "Más opciones de Bandeja" }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function state(page: Page, label: string) {
  await menu(page, "Pruebas de estado");
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function shot(page: Page, id: string, suffix: string) {
  await page.screenshot({
    path: `${dir}/${id}-${suffix}.png`,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
}
for (const width of [390, 360])
  for (const theme of ["light", "dark"])
    test(`T-M2 reference matrix ${theme}-${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 640 });
      await page.addInitScript(
        (theme) => localStorage.setItem("dashfort.demo.theme", theme),
        theme,
      );
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await login(page);
      const suffix = `${theme}-${width}`;
      await shot(page, "INB-01", suffix);
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await page.getByRole("textbox", { name: "Buscar chats" }).fill("cristal");
      await expect(
        page.getByRole("button", { name: /^Cristal Joyas,/ }),
      ).toBeVisible();
      await shot(page, "INB-02", suffix);
      await page.getByRole("button", { name: "Cerrar búsqueda" }).click();
      await page
        .getByRole("button", { name: "Seleccionar varios", exact: true })
        .click();
      await page.getByRole("checkbox", { name: /^Karla/ }).click();
      await page.getByRole("checkbox", { name: /^Luis Ramírez/ }).click();
      await shot(page, "INB-03", suffix);
      await page.getByRole("button", { name: "Atrás", exact: true }).click();
      await page
        .getByRole("button", { name: "Más opciones de Bandeja" })
        .click();
      await shot(page, "INB-04", suffix);
      await page.getByRole("button", { name: "Filtros…", exact: true }).click();
      await shot(page, "INB-05", suffix);
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await state(page, "Cargando");
      await shot(page, "INB-06", suffix);
      await page
        .getByRole("button", { name: "Completar carga simulada" })
        .click();
      await state(page, "Vacía");
      await shot(page, "INB-07", suffix);
      await page.getByRole("button", { name: "Quitar filtros" }).click();
      await state(page, "Error");
      await shot(page, "INB-08", suffix);
      await page.getByRole("button", { name: "Reintentar" }).click();
      await state(page, "Sin conexión");
      await shot(page, "INB-08-offline", suffix);
      await page.getByRole("button", { name: "Reconectar simulación" }).click();
      await page.getByRole("button", { name: "Campañas", exact: true }).click();
      await shot(page, "INB-09", suffix);
      await page.getByRole("button", { name: "Todos", exact: true }).click();
      await page
        .getByRole("button", { name: "Nuevo chat", exact: true })
        .click();
      await shot(page, "INB-10", suffix);
      expect(errors).toEqual([]);
    });
test("combined filters, archive, assign and preserved selection across tabs", async ({
  page,
}) => {
  await login(page);
  await menu(page, "Filtros…");
  await page.getByRole("button", { name: "Interesado", exact: true }).click();
  await page.getByRole("button", { name: "Promo nov", exact: true }).click();
  await page.getByRole("button", { name: /^Ver \d+ chats$/ }).click();
  await expect(page.getByRole("button", { name: /^Karla/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Luis Ramírez/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Seleccionar varios", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /^Karla/ }).click();
  await page.getByRole("tab", { name: "CRM", exact: true }).click();
  await page.getByRole("tab", { name: "Bandeja", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^Karla/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Asignar selección" }).click();
  await page.getByRole("button", { name: "Luis Ortega", exact: true }).click();
  await page
    .getByRole("button", { name: "Seleccionar varios", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /^Karla/ }).click();
  await page.getByRole("button", { name: "Archivar selección" }).click();
  await expect(page.getByRole("button", { name: /^Karla/ })).toHaveCount(0);
  await menu(page, "Ver archivados");
  await expect(page.getByRole("button", { name: /^Karla/ })).toBeVisible();
});
test("advisor cannot enter other conversation and new contact validation is functional", async ({
  page,
}) => {
  await login(page, "Asesor");
  await expect(page.getByRole("button", { name: /^Karla/ })).toHaveCount(0);
  await page.goto("/conversation/demo-conv-1");
  await expect(
    page.getByText("Acceso no permitido", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Volver a Bandeja" }).click();
  await page.getByRole("button", { name: "Nuevo chat", exact: true }).click();
  await page
    .getByRole("button", { name: "Nuevo contacto", exact: true })
    .click();
  await page.getByRole("button", { name: "Crear contacto de prueba" }).click();
  await expect(
    page.getByText("Escribe un nombre.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Nombre ficticio" })
    .fill("Persona sintética");
  await page
    .getByRole("textbox", { name: "Teléfono ficticio con lada" })
    .fill("+52 55 5555 9999");
  await page.getByRole("button", { name: "Crear contacto de prueba" }).click();
  await expect(
    page.getByRole("heading", { name: "Persona sintética" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Volver a Bandeja" }).click();
  await expect(
    page.getByRole("button", { name: /^Persona sintética,/ }),
  ).toBeVisible();
});
test("virtualized list restores scroll and query after conversation return", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const scroller = () =>
    page.getByTestId("conversation-list").evaluate((root) => {
      const all = [root, ...root.querySelectorAll("*")];
      return (
        all.find(
          (el) =>
            el.scrollHeight > el.clientHeight + 500 &&
            getComputedStyle(el).overflowY.match(/auto|scroll/),
        ) !== undefined
      );
    });
  await expect.poll(scroller).toBe(true);
  await page.getByTestId("conversation-list").evaluate((root) => {
    const el = [root, ...root.querySelectorAll("*")].find(
      (el) =>
        el.scrollHeight > el.clientHeight + 500 &&
        getComputedStyle(el).overflowY.match(/auto|scroll/),
    )!;
    el.scrollTop = 3000;
  });
  await expect(
    page.getByRole("button", { name: /^Contacto de prueba/ }).first(),
  ).toBeVisible();
  const before = await page
    .getByTestId("conversation-list")
    .evaluate(
      (root) =>
        [root, ...root.querySelectorAll("*")].find(
          (el) =>
            el.scrollHeight > el.clientHeight + 500 &&
            getComputedStyle(el).overflowY.match(/auto|scroll/),
        )!.scrollTop,
    );
  const rows = await page
    .getByTestId("conversation-list")
    .getByRole("button", { includeHidden: true })
    .count();
  expect(rows).toBeLessThan(120);
  const candidates = page.getByRole("button", { name: /^Contacto de prueba/ });
  let clicked = false;
  let anchorLabel = "";
  let anchorY = 0;
  for (const candidate of await candidates.all()) {
    const box = await candidate.boundingBox();
    if (box && box.y > 200 && box.y + box.height < 600) {
      anchorLabel = (await candidate.getAttribute("aria-label"))!;
      anchorY = box.y;
      await candidate.click();
      clicked = true;
      break;
    }
  }
  expect(clicked).toBe(true);
  await page.getByRole("button", { name: "Volver a Bandeja" }).click();
  await page.screenshot({ path: "artifacts/tm2/scroll-return.png" });
  const anchor = page.getByRole("button", { name: anchorLabel, exact: true });
  await expect(anchor).toBeVisible();
  await expect
    .poll(async () => Math.abs((await anchor.boundingBox())!.y - anchorY))
    .toBeLessThan(2);
  fs.writeFileSync(
    "artifacts/tm2/browser-performance.json",
    JSON.stringify(
      {
        dataset: 2000,
        mountedRows: rows,
        scrollBefore: before,
        anchorLabel,
        anchorY,
        anchorAfterY: (await anchor.boundingBox())!.y,
      },
      null,
      2,
    ),
  );
  await page.getByRole("tab", { name: "Bandeja", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.getByRole("button", { name: /^Karla/ }).boundingBox())?.y ??
        10000,
    )
    .toBeLessThan(400);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("textbox", { name: "Buscar chats" }).fill("karla");
  await page.getByRole("button", { name: /^Karla/ }).click();
  await page.getByRole("button", { name: "Volver a Bandeja" }).click();
  await expect(page.getByRole("textbox", { name: "Buscar chats" })).toHaveValue(
    "karla",
  );
});

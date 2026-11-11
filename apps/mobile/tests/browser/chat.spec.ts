import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
const directory = "artifacts/tm3/screenshots";
fs.mkdirSync(directory, { recursive: true });
async function login(page: Page, role = "Propietario") {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: `Entrar como ${role}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bandeja", exact: true }),
  ).toBeVisible();
}
async function chat(page: Page, id = "demo-conv-1") {
  await page.goto(`/conversation/${id}`);
  await expect(page.getByTestId("message-list")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Volver a Bandeja", exact: true }),
  ).toBeVisible();
}
async function menu(page: Page, label: string) {
  await page
    .getByRole("button", { name: "Opciones del chat", exact: true })
    .click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function demo(page: Page, label: string) {
  await menu(page, "Pruebas de chat");
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function capture(page: Page, id: string, suffix: string) {
  await page.screenshot({
    path: `${directory}/${id}-${suffix}.png`,
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
    test(`T-M3 matrix ${theme}-${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 640 });
      await page.addInitScript(
        (theme) => localStorage.setItem("dashfort.demo.theme", theme),
        theme,
      );
      const errors: string[] = [];
      const external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (
          /^https?:/.test(r.url()) &&
          !r.url().startsWith("http://127.0.0.1:8081")
        )
          external.push(r.url());
      });
      await login(page);
      await chat(page);
      const suffix = `${theme}-${width}`;
      await capture(page, "INB-11", suffix);
      await page
        .getByRole("button", { name: "Opciones del chat", exact: true })
        .click();
      await capture(page, "INB-12", suffix);
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await page.getByRole("button", { name: "Adjuntar", exact: true }).click();
      await capture(page, "INB-13", suffix);
      await page
        .getByRole("button", { name: "Biblioteca", exact: true })
        .click();
      await capture(page, "INB-15", suffix);
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await page
        .getByRole("button", { name: "Respuestas rápidas", exact: true })
        .click();
      await capture(page, "INB-14", suffix);
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await page.getByRole("button", { name: "Emojis", exact: true }).click();
      await capture(page, "INB-16", suffix);
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Mensaje", exact: true })
        .fill("hola, quiero una cotización");
      await page
        .getByRole("button", { name: "Asistente de redacción", exact: true })
        .click();
      await capture(page, "INB-18", suffix);
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await menu(page, "Eliminar chat…");
      await capture(page, "INB-28", suffix);
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await chat(page, "demo-conv-7");
      await page
        .getByRole("button", { name: "Enviar plantilla", exact: true })
        .click();
      await capture(page, "INB-17", suffix);
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await chat(page, "demo-conv-12");
      await expect(
        page
          .getByTestId("message-list")
          .getByText("Te confirmo tu cita del martes", { exact: true }),
      ).toBeVisible();
      await capture(page, "INB-29", suffix);
      await chat(page, "demo-conv-4");
      await page
        .getByRole("button", { name: "Ver imagen de muestra", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Cerrar imagen" }),
      ).toBeVisible();
      await capture(page, "INB-27", suffix);
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    });
test("persistent draft, safe retry after lost confirmation and sent message appears only once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await chat(page);
  const input = page.getByRole("textbox", { name: "Mensaje", exact: true });
  await input.fill("Borrador local persistente");
  await page.getByRole("button", { name: "Volver a Bandeja" }).click();
  await chat(page);
  await expect(input).toHaveValue("Borrador local persistente");
  await page.reload();
  await expect(input).toHaveValue("Borrador local persistente");
  await demo(page, "Perder confirmación del próximo envío");
  await input.fill("Reintento sin duplicados");
  await page
    .getByRole("button", { name: "Enviar mensaje", exact: true })
    .click();
  await expect(
    page.getByText(/No entregado · No llegó la confirmación/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reintentar mensaje", exact: true })
    .click();
  await expect(
    page
      .getByTestId("message-list")
      .getByText("Reintento sin duplicados", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByLabel("Estado: Leído", { exact: true }).last(),
  ).toBeVisible();
  await expect(input).toHaveValue("");
});
test("closed window requires approved template; a template does not unlock until customer reply", async ({
  page,
}) => {
  await login(page);
  await chat(page, "demo-conv-7");
  await expect(
    page.getByRole("textbox", { name: "Mensaje", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Enviar plantilla", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Nombre para plantilla" })
    .fill("Unid");
  await page
    .getByRole("button", { name: "Enviar plantilla de prueba", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Mensaje", exact: true }),
  ).toHaveCount(0);
  await demo(page, "Simular respuesta IA");
  await expect(
    page.getByRole("textbox", { name: "Mensaje", exact: true }),
  ).toHaveCount(0);
  await demo(page, "Simular mensaje de cliente");
  await expect(
    page.getByRole("textbox", { name: "Mensaje", exact: true }),
  ).toBeVisible();
});
test("attachments validate errors, recover a sample and image viewer supports zoom without external sharing", async ({
  page,
}) => {
  await login(page);
  await chat(page);
  await page.getByRole("button", { name: "Adjuntar", exact: true }).click();
  await page
    .getByRole("button", { name: "Probar límite de tamaño", exact: true })
    .click();
  await expect(page.getByText(/solo acepta fotos de hasta 5 MB/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar muestra", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Adjuntar", exact: true }).click();
  await page
    .getByRole("button", { name: "Probar error de lectura", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Enviar muestra", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Volver a cargar muestra", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enviar muestra", exact: true })
    .click();
  const image = page.getByRole("button", {
    name: "Ver imagen de muestra",
    exact: true,
  });
  await expect(image).toBeVisible();
  const imageY = (await image.boundingBox())!.y;
  await image.click();
  await page
    .getByRole("button", { name: "Aumentar zoom", exact: true })
    .click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Restablecer zoom", exact: true })
    .click();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Cerrar imagen", exact: true })
    .click();
  await expect
    .poll(async () =>
      Math.abs(((await image.boundingBox())?.y ?? -10000) - imageY),
    )
    .toBeLessThan(2);
  await expect(
    page.getByRole("textbox", { name: "Mensaje", exact: true }),
  ).toBeVisible();
});
test("quick replies, newline, emoji, rewrite preview and undo preserve drafts", async ({
  page,
}) => {
  await login(page);
  await chat(page);
  const input = page.getByRole("textbox", { name: "Mensaje", exact: true });
  await input.fill("/hola");
  await page
    .getByRole("button", { name: "/hola · Respuestas rápidas", exact: true })
    .click();
  await page.getByRole("button", { name: /^\/hola ·/ }).click();
  await expect(input).toHaveValue(/Hola Karla/);
  await input.fill("hola original");
  await expect(input).toHaveValue("hola original");
  await input.press("End");
  await input.press("Enter");
  await expect(input).toHaveValue("hola original\n");
  await page.getByRole("button", { name: "Emojis", exact: true }).click();
  await page
    .getByRole("button", { name: "Insertar emoji 😊", exact: true })
    .click();
  await expect(input).toHaveValue("hola original\n😊");
  await page
    .getByRole("button", { name: "Asistente de redacción", exact: true })
    .click();
  await page.getByRole("button", { name: "Formal", exact: true }).click();
  // The modal correctly hides its background from the accessibility tree.
  await expect(page.locator('textarea[aria-label="Mensaje"]')).toHaveValue(
    "hola original\n😊",
  );
  await page
    .getByRole("button", { name: "Aplicar al borrador", exact: true })
    .click();
  await expect(input).toHaveValue(/^Con gusto,/);
  await page
    .getByRole("button", { name: "Deshacer redacción", exact: true })
    .click();
  await expect(input).toHaveValue("hola original\n😊");
});
test("paginated history preserves message identity and recovers page failure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await chat(page);
  const list = page.getByTestId("message-list");
  await expect(list).toHaveAttribute("aria-label", /20 mensajes/);
  await demo(page, "Fallar la próxima página");
  await menu(page, "Mensajes anteriores");
  await expect(
    page.getByText("No se pudo cargar la página anterior.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reintentar página", exact: true })
    .click();
  await expect(list).toHaveAttribute("aria-label", /60 mensajes/);
  await menu(page, "Mensajes anteriores");
  await expect(list).toHaveAttribute("aria-label", /100 mensajes/);
  const rows = await list
    .locator("[aria-label]")
    .evaluateAll(
      (nodes) =>
        nodes.filter((n) =>
          /^(Cliente|Equipo|IA|Joe · IA conectada|Nota interna|Evento):/.test(
            n.getAttribute("aria-label") ?? "",
          ),
        ).length,
    );
  expect(rows).toBeLessThan(80);
  fs.writeFileSync(
    "artifacts/tm3/history-metrics.json",
    JSON.stringify(
      { loaded: 100, accessibleMessageNodes: rows, viewport: "390x844" },
      null,
      2,
    ),
  );
});
test("advisor cannot delete; deleting a chat retains contact and persists local empty history", async ({
  page,
}) => {
  await login(page, "Asesor");
  await chat(page, "demo-conv-3");
  await page
    .getByRole("button", { name: "Opciones del chat", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Eliminar chat…", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Entrar como Propietario", exact: true })
    .click();
  await chat(page);
  await menu(page, "Eliminar chat…");
  await page
    .getByRole("button", { name: "Eliminar chat de prueba", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bandeja", exact: true }),
  ).toBeVisible();
  await chat(page);
  await expect(page.getByText("Sin mensajes", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Sin mensajes", { exact: true })).toBeVisible();
});
test("older pages and incoming messages preserve the visible anchor away from the bottom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await chat(page);
  await menu(page, "Mensajes anteriores");
  const list = page.getByTestId("message-list");
  await expect(list).toHaveAttribute("aria-label", /60 mensajes/);
  await list.evaluate((root) => {
    const el = [root, ...root.querySelectorAll("*")].find(
      (el) =>
        el.scrollHeight > el.clientHeight + 500 &&
        /auto|scroll/.test(getComputedStyle(el).overflowY),
    )!;
    el.scrollTop = 1000;
  });
  let label = "";
  let y = 0;
  await expect
    .poll(async () => {
      for (const row of await list
        .locator('[aria-label^="Cliente:"],[aria-label^="Equipo:"]')
        .all()) {
        const box = await row.boundingBox();
        if (box && box.y > 180 && box.y + box.height < 450) {
          label = (await row.getAttribute("aria-label"))!;
          y = box.y;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  const row = () => list.locator(`[aria-label=${JSON.stringify(label)}]`);
  await menu(page, "Mensajes anteriores");
  await expect(list).toHaveAttribute("aria-label", /100 mensajes/);
  await expect
    .poll(async () => Math.abs(((await row().boundingBox())?.y ?? -10000) - y))
    .toBeLessThan(2);
  const afterPage = (await row().boundingBox())!.y;
  await demo(page, "Simular mensaje de cliente");
  await expect(
    page.getByRole("button", { name: "1 mensajes nuevos", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => Math.abs(((await row().boundingBox())?.y ?? -10000) - y))
    .toBeLessThan(2);
  await page.screenshot({ path: "artifacts/tm3/history-anchor.png" });
  fs.writeFileSync(
    "artifacts/tm3/scroll-metrics.json",
    JSON.stringify(
      {
        label,
        beforeY: y,
        afterPageY: afterPage,
        afterIncomingY: (await row().boundingBox())!.y,
      },
      null,
      2,
    ),
  );
  await page
    .getByRole("button", { name: "1 mensajes nuevos", exact: true })
    .click();
  await expect(
    list.getByText("Mensaje entrante de prueba", { exact: true }),
  ).toBeVisible();
});
test("recoverable data states preserve the draft and reconnect pending incoming once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await chat(page);
  const input = page.getByRole("textbox", { name: "Mensaje", exact: true });
  await input.fill("No perder este borrador");
  await demo(page, "Mostrar cargando");
  await expect(
    page.getByRole("button", { name: "Enviar mensaje", exact: true }),
  ).toBeDisabled();
  await capture(page, "state-loading", "light-390");
  await page
    .getByRole("button", { name: "Finalizar carga simulada", exact: true })
    .click();
  await expect(input).toHaveValue("No perder este borrador");
  await demo(page, "Mostrar error");
  await capture(page, "state-error", "light-390");
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await demo(page, "Mostrar vacío");
  await expect(
    page.getByTestId("message-list").getByText("Sin mensajes", { exact: true }),
  ).toBeVisible();
  await capture(page, "state-empty", "light-390");
  await demo(page, "Mostrar sin conexión");
  await demo(page, "Simular mensaje de cliente");
  await expect(
    page
      .getByTestId("message-list")
      .getByText("Mensaje entrante de prueba", { exact: true }),
  ).toHaveCount(0);
  await capture(page, "state-offline", "light-390");
  await page
    .getByRole("button", { name: "Reconectar simulación", exact: true })
    .click();
  await expect(
    page
      .getByTestId("message-list")
      .getByText("Mensaje entrante de prueba", { exact: true }),
  ).toHaveCount(1);
  await expect(input).toHaveValue("No perder este borrador");
});

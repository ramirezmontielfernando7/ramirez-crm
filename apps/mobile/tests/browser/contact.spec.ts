import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
const directory = "artifacts/tm4/screenshots";
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
async function details(page: Page, id = "demo-conv-1") {
  await page.goto(`/contact/${id}`);
  await expect(page.getByTestId("contact-details")).toBeVisible();
}
async function more(page: Page, label: string) {
  await page
    .getByRole("button", { name: "Más opciones del contacto", exact: true })
    .click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function demo(page: Page, label?: string) {
  if (
    await page
      .getByRole("button", { name: "Más opciones del contacto", exact: true })
      .count()
  )
    await more(page, "Pruebas de detalles");
  else
    await page
      .getByRole("button", { name: "Opciones del historial", exact: true })
      .click();
  if (label)
    await page.getByRole("button", { name: label, exact: true }).click();
}
const close = (page: Page) =>
  page.getByRole("button", { name: "Cerrar", exact: true }).click();
async function toggle(page: Page, label: string) {
  await page.getByRole("switch", { name: label, exact: true }).click();
}
async function shot(page: Page, id: string, suffix: string) {
  await page.screenshot({
    path: `${directory}/${id}-${suffix}.png`,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  const small = await page
    .locator('[role="button"],[role="radio"],[role="checkbox"],[role="switch"]')
    .evaluateAll((nodes) =>
      nodes
        .filter(
          (n) =>
            !n.closest('[aria-hidden="true"]') &&
            n.getBoundingClientRect().width > 0 &&
            n.getBoundingClientRect().height > 0,
        )
        .filter((n) => {
          const b = n.getBoundingClientRect();
          return (
            b.y >= 0 &&
            b.bottom <= innerHeight &&
            (b.width < 43 || b.height < 43)
          );
        })
        .map((n) => n.getAttribute("aria-label") || n.textContent),
    );
  expect(small).toEqual([]);
}
for (const width of [390, 360])
  for (const theme of ["light", "dark"])
    test(`T-M4 approved matrix ${theme}-${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 640 });
      await page.addInitScript(
        (theme) => localStorage.setItem("dashfort.demo.theme", theme),
        theme,
      );
      const errors: string[] = [],
        external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (
          /^https?:/.test(r.url()) &&
          !r.url().startsWith("http://127.0.0.1:8081")
        )
          external.push(r.url());
      });
      await login(page);
      await details(page);
      await demo(page);
      await toggle(page, "Complemento Conexión directa");
      await close(page);
      const suffix = `${theme}-${width}`;
      await shot(page, "INB-19", suffix);
      await page.getByRole("button", { name: /^Etapa ·/ }).click();
      await shot(page, "INB-21", suffix);
      await close(page);
      await page.getByRole("button", { name: /^Asignado ·/ }).click();
      await shot(page, "INB-22", suffix);
      await close(page);
      await page.getByRole("button", { name: /^Etiquetas ·/ }).click();
      await shot(page, "INB-23", suffix);
      await close(page);
      await page.getByRole("button", { name: /^IA en este chat ·/ }).click();
      await shot(page, "INB-24", suffix);
      await close(page);
      await page.getByRole("button", { name: /^Conexión del chat ·/ }).click();
      await shot(page, "INB-30", suffix);
      await close(page);
      await page.getByRole("button", { name: /^Etapa ·/ }).click();
      await page.getByRole("radio", { name: "Perdido", exact: true }).click();
      await shot(page, "INB-25", suffix);
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Nueva tarea para este chat",
          exact: true,
        })
        .click();
      await shot(page, "INB-26", suffix);
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await more(page, "Ver historial");
      await expect(page.getByTestId("contact-history")).toBeVisible();
      await shot(page, "INB-20", suffix);
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    });
test("stage cancel, assignment, tag toggling, AI and sale survive navigation and reload", async ({
  page,
}) => {
  await login(page);
  await details(page);
  await page.getByRole("button", { name: /^Etapa ·/ }).click();
  await page.getByRole("radio", { name: "Perdido", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Etapa · Interesado", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Etapa ·/ }).click();
  await page.getByRole("radio", { name: "Perdido", exact: true }).click();
  await page.getByRole("radio", { name: "Precio", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Detalle (opcional)", exact: true })
    .fill("Presupuesto ficticio");
  await page
    .getByRole("button", { name: "Marcar perdido", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Etapa · Perdido", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Asignado ·/ }).click();
  await page.getByRole("radio", { name: "Ana López", exact: true }).click();
  await page.getByRole("button", { name: /^Etiquetas ·/ }).click();
  await page.getByRole("checkbox", { name: "VIP", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "VIP", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await page.getByRole("button", { name: /^IA en este chat ·/ }).click();
  await page.getByRole("radio", { name: "Apagada", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Apagada", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await page.getByRole("button", { name: /^Monto ·/ }).click();
  await page
    .getByRole("textbox", { name: "Monto de la venta", exact: true })
    .fill("5200.25");
  await page
    .getByRole("button", { name: "Guardar monto", exact: true })
    .click();
  await page.getByRole("button", { name: /^Prioridad ·/ }).click();
  await page.getByRole("radio", { name: "Media", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Etapa · Perdido", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Asignado · Ana López", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "IA en este chat · Apagada",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Monto · \$5,200.25/ }),
  ).toBeVisible();
  await more(page, "Ver historial");
  await expect(
    page.getByTestId("contact-history").getByText(/Presupuesto ficticio/),
  ).toBeVisible();
});
test("INB-30 gates, linked device, failure, emergency and double AI warning", async ({
  page,
}) => {
  await login(page);
  await details(page);
  await expect(
    page.getByRole("button", { name: /^Conexión del chat ·/ }),
  ).toHaveCount(0);
  await demo(page);
  await toggle(page, "Complemento Conexión directa");
  await close(page);
  await page.getByRole("button", { name: /^Conexión del chat ·/ }).click();
  await page
    .getByRole("radio", { name: "Conexión directa", exact: true })
    .click();
  await expect(
    page.getByText(/Hace falta un dispositivo vinculado/),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Meta", exact: true }),
  ).toBeChecked();
  await close(page);
  await demo(page);
  await toggle(page, "Dispositivo ficticio vinculado");
  await page
    .getByRole("button", { name: "Fallar el próximo cambio", exact: true })
    .click();
  await page.getByRole("button", { name: /^Conexión del chat ·/ }).click();
  await page
    .getByRole("radio", { name: "Conexión híbrida", exact: true })
    .click();
  await expect(page.getByText(/No se pudo guardar el cambio/)).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Meta", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("radio", { name: "Conexión híbrida", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Conexión híbrida", exact: true }),
  ).toBeChecked();
  await close(page);
  await demo(page);
  await toggle(page, "Pausa de emergencia");
  await toggle(page, "Cerebro externo conectado");
  await close(page);
  await page.getByRole("button", { name: /^Conexión del chat ·/ }).click();
  await page
    .getByRole("radio", { name: "Conexión directa", exact: true })
    .click();
  await expect(page.getByText(/Hay una pausa de emergencia/)).toBeVisible();
  await page.getByRole("radio", { name: "Meta", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Meta", exact: true }),
  ).toBeChecked();
  await close(page);
  await page.getByRole("button", { name: /^IA en este chat ·/ }).click();
  await page.getByRole("radio", { name: "La IA atiende", exact: true }).click();
  await expect(page.getByText(/Doble respuesta:/)).toBeVisible();
});
test("notes retain draft and filter across navigation, survive save failure and never appear as sent chat messages", async ({
  page,
}) => {
  await login(page);
  await page.goto("/conversation/demo-conv-1");
  await expect(page.getByTestId("message-list")).toBeVisible();
  await page
    .getByRole("button", { name: "Detalles de Karla Méndez", exact: true })
    .click();
  await more(page, "Ver historial");
  const input = page.getByRole("textbox", {
    name: "Nueva nota interna",
    exact: true,
  });
  await input.fill("Nota privada de prueba");
  await page.getByRole("button", { name: "Notas", exact: true }).click();
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  await more(page, "Ver historial");
  await expect(input).toHaveValue("Nota privada de prueba");
  await expect(page.getByTestId("contact-history")).toHaveAttribute(
    "aria-label",
    /1 eventos/,
  );
  await demo(page, "Fallar el próximo cambio");
  await page
    .getByRole("button", { name: "Guardar nota interna", exact: true })
    .click();
  await expect(page.getByText(/No se pudo guardar el cambio/)).toBeVisible();
  await expect(input).toHaveValue("Nota privada de prueba");
  await page
    .getByRole("button", { name: "Guardar nota interna", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await expect(
    page
      .getByTestId("contact-history")
      .getByText("Nota privada de prueba", { exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  await expect(page.getByTestId("message-list")).toBeVisible();
  await expect(
    page
      .getByTestId("message-list")
      .getByText("Nota privada de prueba", { exact: true }),
  ).toHaveCount(0);
});
test("task validates date, preserves typed title, saves once and completion persists", async ({
  page,
}) => {
  await login(page);
  await details(page);
  await page
    .getByRole("button", { name: "Nueva tarea para este chat", exact: true })
    .click();
  await page.getByRole("button", { name: "Crear tarea", exact: true }).click();
  await expect(page.getByText(/Escribe una tarea/)).toBeVisible();
  await page
    .getByRole("textbox", { name: "¿Qué hay que hacer?", exact: true })
    .fill("Cotización de muestra");
  await page.getByRole("button", { name: /^Fecha límite ·/ }).click();
  await page
    .getByRole("textbox", { name: "Fecha · DD/MM/AAAA", exact: true })
    .fill("31/02/2026");
  await page.getByRole("button", { name: "Crear tarea", exact: true }).click();
  await expect(
    page.getByText("Fecha u hora no válida.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Fecha · DD/MM/AAAA", exact: true })
    .fill("12/11/2026");
  await page
    .getByRole("textbox", { name: "Hora · HH:mm", exact: true })
    .fill("17:00");
  await page.getByRole("button", { name: /^Responsable ·/ }).click();
  await page.getByRole("radio", { name: "Ana López", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "¿Qué hay que hacer?", exact: true }),
  ).toHaveValue("Cotización de muestra");
  await page.getByRole("button", { name: "Crear tarea", exact: true }).click();
  const task = page.getByRole("checkbox", {
    name: "Cotización de muestra",
    exact: true,
  });
  await expect(task).toHaveCount(1);
  await task.click();
  await expect(task).toBeChecked();
  await page.reload();
  await expect(task).toBeChecked();
});
test("advisor hides assignment and connection by default; protected import tag and deep links respect scope", async ({
  page,
}) => {
  await login(page, "Asesor");
  await details(page, "demo-conv-3");
  await expect(page.getByRole("button", { name: /^Asignado ·/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /^Conexión del chat ·/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Etiquetas ·/ }).click();
  await expect(
    page.getByRole("checkbox", { name: "Importación · demo", exact: true }),
  ).toBeDisabled();
  await close(page);
  await demo(page);
  await toggle(page, "Complemento Conexión directa");
  await close(page);
  await expect(
    page.getByRole("button", { name: /^Conexión del chat ·/ }),
  ).toHaveCount(0);
  await page.goto("/contact/demo-conv-1");
  await expect(
    page.getByText("Acceso no permitido", { exact: true }),
  ).toBeVisible();
  await page.goto("/history/demo-conv-1");
  await expect(
    page.getByText("Acceso no permitido", { exact: true }),
  ).toBeVisible();
});
test("details and history recover loading empty error offline without losing note draft", async ({
  page,
}) => {
  await login(page);
  await details(page);
  for (const [label, state] of [
    ["Mostrar cargando", "loading"],
    ["Mostrar vacío", "empty"],
    ["Mostrar error", "error"],
    ["Mostrar sin conexión", "offline"],
  ]) {
    await demo(page, label);
    await shot(page, `details-${state}`, "light-390");
    if (state === "loading")
      await page
        .getByRole("button", { name: "Finalizar carga simulada", exact: true })
        .click();
    if (state === "empty")
      await page
        .getByRole("button", { name: "Volver a los detalles", exact: true })
        .click();
    if (state === "error")
      await page
        .getByRole("button", { name: "Reintentar", exact: true })
        .click();
    if (state === "offline")
      await page
        .getByRole("button", { name: "Reconectar detalles", exact: true })
        .click();
  }
  await more(page, "Ver historial");
  const input = page.getByRole("textbox", {
    name: "Nueva nota interna",
    exact: true,
  });
  await input.fill("Conservar durante estados");
  for (const [label, state] of [
    ["Mostrar cargando", "loading"],
    ["Mostrar vacío", "empty"],
    ["Mostrar error", "error"],
    ["Mostrar sin conexión", "offline"],
  ]) {
    await demo(page, label);
    await shot(page, `history-${state}`, "light-390");
    await expect(input).toHaveValue("Conservar durante estados");
    if (state !== "empty")
      await expect(
        page.getByRole("button", { name: "Guardar nota interna", exact: true }),
      ).toBeDisabled();
    if (state === "loading")
      await page
        .getByRole("button", { name: "Finalizar carga simulada", exact: true })
        .click();
    else if (state === "error")
      await page
        .getByRole("button", { name: "Reintentar", exact: true })
        .click();
    else if (state === "offline")
      await page
        .getByRole("button", { name: "Reconectar historial", exact: true })
        .click();
    else await demo(page, "Mostrar detalles normales");
  }
});
test("Inbox scroll and chat message anchor survive details/history round trip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const inbox = page.getByTestId("conversation-list");
  await expect
    .poll(() =>
      inbox.evaluate((root) =>
        [root, ...root.querySelectorAll("*")].some(
          (el) =>
            el.scrollHeight > el.clientHeight + 500 &&
            /auto|scroll/.test(getComputedStyle(el).overflowY),
        ),
      ),
    )
    .toBe(true);
  await inbox.evaluate((root) => {
    const el = [root, ...root.querySelectorAll("*")].find(
      (el) =>
        el.scrollHeight > el.clientHeight + 500 &&
        /auto|scroll/.test(getComputedStyle(el).overflowY),
    )!;
    el.scrollTop = 3000;
  });
  let name = "",
    label = "",
    y = 0;
  await expect
    .poll(async () => {
      for (const row of await inbox
        .getByRole("button", { name: /^Contacto de prueba/ })
        .all()) {
        const b = await row.boundingBox();
        if (b && b.y > 200 && b.y + b.height < 600) {
          label = (await row.getAttribute("aria-label"))!;
          name = label.split(",")[0]!;
          y = b.y;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByTestId("message-list")).toBeVisible();
  await page
    .getByRole("button", { name: "Opciones del chat", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mensajes anteriores", exact: true })
    .click();
  const messages = page.getByTestId("message-list");
  await messages.evaluate((root) => {
    const el = [root, ...root.querySelectorAll("*")].find(
      (el) =>
        el.scrollHeight > el.clientHeight + 500 &&
        /auto|scroll/.test(getComputedStyle(el).overflowY),
    )!;
    el.scrollTop = 1000;
  });
  let anchor = "",
    messageY = 0;
  await expect
    .poll(async () => {
      for (const row of await messages
        .locator('[aria-label^="Cliente:"],[aria-label^="Equipo:"]')
        .all()) {
        const b = await row.boundingBox();
        if (b && b.y > 180 && b.y + b.height < 450) {
          anchor = (await row.getAttribute("aria-label"))!;
          messageY = b.y;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  await page
    .getByRole("button", { name: `Detalles de ${name}`, exact: true })
    .click();
  await more(page, "Ver historial");
  await expect(page.getByTestId("contact-history")).toBeVisible();
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  const message = messages.locator(`[aria-label=${JSON.stringify(anchor)}]`);
  await expect
    .poll(async () =>
      Math.abs(((await message.boundingBox())?.y ?? -10000) - messageY),
    )
    .toBeLessThan(2);
  const messageAfter = (await message.boundingBox())!.y;
  await page
    .getByRole("button", { name: "Volver a Bandeja", exact: true })
    .click();
  const row = page.getByRole("button", { name: label, exact: true });
  await expect
    .poll(async () => Math.abs(((await row.boundingBox())?.y ?? -10000) - y))
    .toBeLessThan(2);
  fs.writeFileSync(
    "artifacts/tm4/navigation-metrics.json",
    JSON.stringify(
      {
        inbox: { label, before: y, after: (await row.boundingBox())!.y },
        chat: { anchor, before: messageY, after: messageAfter },
      },
      null,
      2,
    ),
  );
});

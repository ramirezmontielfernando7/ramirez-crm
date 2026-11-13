import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
const dir = "artifacts/tm5a";
fs.mkdirSync(dir, { recursive: true });
async function login(page: Page, role = "Propietario") {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: `Entrar como ${role}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bandeja", exact: true }),
  ).toBeVisible();
}
async function lab(page: Page) {
  await page.goto("/demo?notifications=1");
  await expect(page.getByText(/Sesión: demo-/)).toBeVisible();
  await page
    .getByRole("button", { name: "Conceder permiso ficticio", exact: true })
    .click();
  await expect(page.getByText(/Registro ficticio: activo/)).toBeVisible();
}
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
test("fictitious notifications group and deduplicate; tap opens Chat with canonical incoming messages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await lab(page);
  await button(page, "Simular mensaje entrante").click();
  await expect(
    page.getByText("Grupos de conversación: 1", { exact: true }),
  ).toBeVisible();
  await button(page, "Repetir último evento").click();
  await expect(page.getByText(/Eventos conocidos: 1$/)).toBeVisible();
  await button(page, "Simular mensaje entrante").click();
  await expect(page.getByText(/Eventos conocidos: 2$/)).toBeVisible();
  await expect(
    page.getByText("Grupos de conversación: 1", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${dir}/qa-group-light-390.png` });
  await button(page, "Abrir aviso ficticio").click();
  await expect(page.getByTestId("message-list")).toHaveAttribute(
    "aria-label",
    /22 mensajes/,
  );
  await expect(
    page
      .getByTestId("message-list")
      .getByText("Mensaje entrante de prueba", { exact: true }),
  ).toHaveCount(2);
  await button(page, "Volver a Bandeja").click();
  await expect(
    page.getByRole("heading", { name: "Simulación de avisos", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test("permission states never request browser/OS permission; revoked groups disappear", async ({
  page,
  context,
}) => {
  await context.clearPermissions();
  await page.addInitScript(() => {
    (window as unknown as { permissionRequests: number }).permissionRequests =
      0;
    Notification.requestPermission = async () => {
      (window as unknown as { permissionRequests: number })
        .permissionRequests++;
      return "denied";
    };
  });
  await login(page);
  await lab(page);
  await button(page, "Denegar permiso ficticio").click();
  await button(page, "Simular mensaje entrante").click();
  await expect(
    page.getByText("Grupos de conversación: 0", { exact: true }),
  ).toBeVisible();
  await button(page, "Conceder permiso ficticio").click();
  await button(page, "Simular handoff").click();
  await expect(
    page.getByText("Grupos de conversación: 1", { exact: true }),
  ).toBeVisible();
  await button(page, "Renovar token ficticio").click();
  await expect(
    page.getByText("Token ficticio renovado", { exact: true }),
  ).toBeVisible();
  await button(page, "Revocar permiso ficticio").click();
  await expect(
    page.getByText("Grupos de conversación: 0", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Registro ficticio: inactivo/)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { permissionRequests: number })
          .permissionRequests,
    ),
  ).toBe(0);
});
test("offline synchronization catches up once and does not alert on outgoing or expired events", async ({
  page,
}) => {
  await login(page);
  await lab(page);
  await button(page, "Simular mensaje saliente").click();
  await button(page, "Simular evento caducado").click();
  await button(page, "Simular evento de otra organización").click();
  await expect(
    page.getByText("Grupos de conversación: 0", { exact: true }),
  ).toBeVisible();
  await button(page, "Desconectar simulación").click();
  await button(page, "Simular mensaje entrante").click();
  await expect(
    page.getByText("Grupos de conversación: 0", { exact: true }),
  ).toBeVisible();
  await button(page, "Reconectar simulación").click();
  await expect(
    page.getByText("Grupos de conversación: 1", { exact: true }),
  ).toBeVisible();
  await button(page, "Sincronizar muestra").click();
  await expect(
    page.getByText("Grupos de conversación: 1", { exact: true }),
  ).toBeVisible();
});
test("foreground restoration and sync error are recoverable", async ({
  page,
}) => {
  await login(page);
  await lab(page);
  await button(page, "Simular segundo plano").click();
  await button(page, "Desconectar simulación").click();
  await button(page, "Simular mensaje entrante").click();
  await button(page, "Fallar próxima sincronización").click();
  await button(page, "Reconectar simulación").click();
  await expect(
    page.getByText("Falló la sincronización ficticia. Reintenta.", {
      exact: true,
    }),
  ).toBeVisible();
  await button(page, "Simular regreso a primer plano").click();
  await expect(
    page.getByText("Grupos de conversación: 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Sincronización ficticia completada", { exact: true }),
  ).toBeVisible();
});
test("cross-org, revoked membership and notification logout cannot open unauthorized chats", async ({
  page,
}) => {
  await login(page);
  await lab(page);
  await button(page, "Simular mensaje entrante").click();
  await button(page, "Simular pérdida de pertenencia").click();
  await expect(page.getByText(/Registro ficticio: inactivo/)).toBeVisible();
  await button(page, "Tocar último aviso ficticio").click();
  await expect(
    page.getByText("Acceso denegado al destino", { exact: true }),
  ).toBeVisible();
  await button(page, "Restaurar pertenencia ficticia").click();
  await button(page, "Cambiar organización ficticia").click();
  await expect(
    page.getByText("Sesión: demo-owner · demo-org-b", { exact: true }),
  ).toBeVisible();
  await button(page, "Simular mensaje entrante").click();
  await button(page, "Abrir aviso ficticio").click();
  await expect(
    page.getByText("Acceso denegado al destino", { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/demo");
  await button(page, "Cerrar sesión de notificaciones").click();
  await expect(
    page.getByText("Sesión: Sin sesión ficticia", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Grupos de conversación: 0", { exact: true }),
  ).toBeVisible();
});
test("advisor notification can open own chat and preserve existing details/history navigation", async ({
  page,
}) => {
  await login(page, "Asesor");
  await lab(page);
  await button(page, "Simular handoff").click();
  await button(page, "Abrir aviso ficticio").click();
  await expect(page.getByTestId("message-list")).toBeVisible();
  await button(page, "Detalles de Cristal Joyas").click();
  await expect(page.getByTestId("contact-details")).toBeVisible();
  await button(page, "Más opciones del contacto").click();
  await button(page, "Ver historial").click();
  await expect(page.getByTestId("contact-history")).toBeVisible();
});

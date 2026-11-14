import { test, expect } from "@playwright/test";
import fs from "node:fs";
test("local lab is opt-in and web never requests system permission; demo navigation remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Entrar como Propietario", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bandeja", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Solicitar permiso Android",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Laboratorio de notificaciones", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Solicitar permiso Android", exact: true })
    .click();
  await expect(
    page.getByText("Permiso Android: unsupported", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Probar aviso local ahora", exact: true })
    .click();
  await expect(
    page.getByText("Sin permiso local; la aplicación sigue disponible", {
      exact: true,
    }),
  ).toBeVisible();
  fs.mkdirSync("artifacts/tm5b", { recursive: true });
  await page
    .getByText("Pruebas locales Android · T-M5B", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/tm5b/lab-local-web-light.png" });
  await page.reload();
  await expect(page.getByText(/Sesión: demo-owner/)).toBeVisible();
  await page
    .getByRole("button", { name: "Consultar permiso Android", exact: true })
    .click();
  await expect(
    page.getByText("Permiso Android: unsupported", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

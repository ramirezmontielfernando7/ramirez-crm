import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
const shotDir = "artifacts/screenshots";
fs.mkdirSync(shotDir, { recursive: true });
async function capture(page: Page, id: string, suffix: string) {
  await page.screenshot({
    path: `${shotDir}/${id}-${suffix}.png`,
    animations: "disabled",
  });
  const smallTargets = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],input,textarea',
      ),
    )
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          !el.closest('[aria-hidden="true"]') &&
          (box.width < 44 || box.height < 44)
        );
      })
      .map((el) => ({
        label: el.getAttribute("aria-label") || el.textContent,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
  );
  expect(smallTargets, `touch targets ${id}`).toEqual([]);
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  expect(horizontalOverflow, `horizontal overflow ${id}`).toBe(false);
}
for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  for (const theme of ["light", "dark"] as const) {
    const suffix = `${theme}-${size.width}x${size.height}`;
    test(`T-M1 galleries and access ${suffix}`, async ({ page }) => {
      await page.setViewportSize(size);
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
      await page.addInitScript((theme) => {
        localStorage.setItem("dashfort.demo.theme", theme);
      }, theme);
      await page.goto("/login");
      await expect(
        page.getByRole("button", { name: "Iniciar sesión", exact: true }),
      ).toBeVisible();
      await capture(page, "AUTH-02", suffix);
      await page
        .getByRole("button", { name: "¿Olvidaste tu contraseña?" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Pide un enlace nuevo" }),
      ).toBeVisible();
      await capture(page, "AUTH-06", suffix);
      await page.getByRole("button", { name: "Entendido" }).click();
      for (let n = 1; n <= 6; n++) {
        await page.goto(`/design/DS-0${n}`);
        await expect(page.getByRole("heading").first()).toBeVisible();
        await capture(page, `DS-0${n}`, suffix);
      }
      await page.goto("/activar/demo-activate");
      await expect(
        page.getByRole("button", { name: "Activar y entrar" }),
      ).toBeVisible();
      await capture(page, "AUTH-03", suffix);
      await page.goto("/restablecer/demo-reset");
      await expect(
        page.getByRole("button", { name: "Guardar y entrar" }),
      ).toBeVisible();
      await capture(page, "AUTH-04", suffix);
      await page.goto("/register");
      await expect(
        page.getByRole("button", { name: "Crear cuenta" }),
      ).toBeDisabled();
      await capture(page, "AUTH-05", suffix);
      await page.goto("/login");
      await page
        .getByRole("button", { name: "Iniciar sesión", exact: true })
        .click();
      await expect(
        page.getByRole("tab", { name: "Bandeja", exact: true }),
      ).toBeVisible();
      await capture(page, "NAV-owner", suffix);
      await page.getByRole("tab", { name: "Más", exact: true }).click();
      await page
        .getByRole("button", { name: "Cerrar sesión", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "¿Cerrar sesión?" }),
      ).toBeVisible();
      await capture(page, "MORE-08", suffix);
      await page.getByRole("button", { name: "Cancelar" }).click();
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
test("roles, route guards, recovery and logout", async ({ page }) => {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Entrar como Propietario", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(5);
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(5);
  await page.goto("/demo");
  await page
    .getByRole("switch", { name: "Estudio IA disponible en el plan" })
    .click();
  await expect(
    page.getByRole("switch", { name: "Estudio IA disponible en el plan" }),
  ).toHaveAttribute("aria-checked", "false");
  await page
    .getByRole("button", { name: "Probar enlace a Estudio IA" })
    .click();
  await expect(
    page.getByText("No disponible en tu plan", { exact: true }),
  ).toBeVisible();
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Entrar como Coordinador", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.getByRole("tab", { name: "Estudio IA" })).toHaveCount(0);
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Entrar como Asesor", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await page.goto("/marketing");
  await expect(
    page.getByText("Acceso no permitido", { exact: true }),
  ).toBeVisible();
  await page.goto("/more");
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
  await page.goto("/inbox");
  await expect(
    page.getByRole("button", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
});
test("form validation, generic auth failure and expired session", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Correo", exact: true })
    .fill("incorrecto");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page.getByText("ⓘ Escribe un correo válido.")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Correo", exact: true })
    .fill("fer@ejemplo.mx");
  await page.getByLabel("Contraseña", { exact: true }).fill("wrong");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(
    page.getByText("Correo o contraseña incorrectos. Intenta de nuevo."),
  ).toBeVisible();
  await page.getByLabel("Contraseña", { exact: true }).fill("Dashfort2026");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await page.goto("/demo");
  await page.getByRole("button", { name: "Simular sesión caducada" }).click();
  await expect(
    page.getByText("Tu sesión caducó. Vuelve a iniciar sesión."),
  ).toBeVisible();
});
test("single-use activation and reset, invalid link, repeated password", async ({
  page,
}) => {
  await page.goto("/activar/demo-activate");
  await page.getByLabel("Contraseña nueva", { exact: true }).fill("12345678");
  await page
    .getByLabel("Repite la contraseña", { exact: true })
    .fill("87654321");
  await page.getByRole("button", { name: "Activar y entrar" }).click();
  await expect(page.getByText("ⓘ Las contraseñas no coinciden.")).toBeVisible();
  await page
    .getByLabel("Repite la contraseña", { exact: true })
    .fill("12345678");
  await page.getByRole("button", { name: "Activar y entrar" }).click();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await page.goto("/demo");
  await page.getByRole("button", { name: "Simular sesión caducada" }).click();
  await page.goto("/activar/demo-activate");
  for (const label of ["Contraseña nueva", "Repite la contraseña"])
    await page.getByLabel(label, { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Activar y entrar" }).click();
  await expect(
    page.getByText("Este enlace ya se usó o venció. Pide uno nuevo."),
  ).toBeVisible();
  await page.goto("/restablecer/vencido");
  for (const label of ["Contraseña nueva", "Repite la contraseña"])
    await page.getByLabel(label, { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(
    page.getByText("Este enlace ya se usó o venció. Pide uno nuevo."),
  ).toBeVisible();
  await page.goto("/restablecer/demo-reset");
  for (const label of ["Contraseña nueva", "Repite la contraseña"])
    await page.getByLabel(label, { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(page.getByRole("tab")).toHaveCount(3);
});
test("layers, simulated composer and recoverable data states", async ({
  page,
}) => {
  await page.goto("/design/DS-06");
  await page
    .getByRole("button", { name: "Hoja inferior (acciones)", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Adjuntar · Ejemplo" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Adjuntar · Ejemplo" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Hoja de selección" }).click();
  await page.getByRole("button", { name: "Cliente", exact: true }).click();
  await expect(page.getByText("Cliente", { exact: true })).toBeVisible();
  await page.goto("/design/DS-04");
  await page
    .getByRole("textbox", { name: "Mensaje de prueba", exact: true })
    .fill("Hola de prueba");
  await page.getByRole("button", { name: "Enviar mensaje de prueba" }).click();
  await expect(page.getByText("Hola de prueba", { exact: true })).toBeVisible();
  await page.goto("/design/DS-05");
  await page.getByRole("button", { name: "Error", exact: true }).click();
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(
    page.getByRole("button", { name: "Normal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

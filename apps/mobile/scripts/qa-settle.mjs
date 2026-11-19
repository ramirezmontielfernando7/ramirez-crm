/** Flush RN Web Modal portal and React layout before visual evidence. No server. */
export async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
export function capturePage(page) {
  return async (options) => {
    const name = String(options.path);
    let title;
    if (name.includes("CRM-31-")) title = "Detalle de la tarea";
    else if (name.includes("CRM-33-")) title = "Nota";
    else if (name.includes("RES-02-")) title = "Periodo y asesor";
    else if (name.includes("LAB-11-")) title = "Subir documento";
    else if (name.includes("LAB-12-")) title = "Catálogo mayoreo 2026.pdf";
    if (title)
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await settle(page);
    await page.screenshot(options);
  };
}

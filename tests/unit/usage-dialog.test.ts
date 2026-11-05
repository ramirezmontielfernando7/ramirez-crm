import { afterEach, describe, expect, it } from "vitest";
import { closeUsageDialog, getUsageDialogState, openUsageDialog, setUsageDialogView, subscribeUsageDialog } from "@/lib/usage-dialog";

describe("«Uso y plan» como ventana", () => {
  afterEach(() => closeUsageDialog());

  it("abre, cambia de vista y cierra avisando a quien escucha", () => {
    let avisos = 0;
    const baja = subscribeUsageDialog(() => (avisos += 1));
    openUsageDialog();
    expect(getUsageDialogState()).toEqual({ open: true, view: "uso" });
    setUsageDialogView("planes");
    expect(getUsageDialogState().view).toBe("planes");
    closeUsageDialog();
    expect(getUsageDialogState().open).toBe(false);
    closeUsageDialog(); // ya cerrada: no avisa otra vez
    expect(avisos).toBe(3);
    baja();
  });
});

import { describe, expect, it } from "vitest";
import { mergeLatest } from "@/lib/mi-numero-thread";
import type { MessageDto } from "@/lib/types";

const m = (id: string, status = "sent") => ({ id, status }) as unknown as MessageDto;

describe("DF-15: unir el bloque reciente con lo ya cargado", () => {
  it("sin nada en pantalla, manda el bloque", () => {
    expect(mergeLatest(null, [m("3"), m("4")]).map((x) => x.id)).toEqual(["3", "4"]);
  });
  it("conserva lo anterior que se pidió al subir y actualiza el bloque", () => {
    const prev = [m("1"), m("2"), m("3", "sent"), m("4")];
    const page = [m("3", "read"), m("4"), m("5")];
    const r = mergeLatest(prev, page);
    expect(r.map((x) => x.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(r[2]!.status).toBe("read");
  });
  it("si el bloque no se toca con lo de pantalla, manda el bloque", () => {
    expect(mergeLatest([m("1"), m("2")], [m("8"), m("9")]).map((x) => x.id)).toEqual(["8", "9"]);
  });
});

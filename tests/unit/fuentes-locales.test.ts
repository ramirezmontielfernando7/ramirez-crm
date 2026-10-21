import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// El build no debe depender de Google Fonts: las letras viven en el repo.
const root = path.resolve(__dirname, "../..");
const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

describe("fuentes locales", () => {
  it("ningún archivo de src usa next/font/google", () => {
    const culpables = filesUnder(path.join(root, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /from\s+["']next\/font\/google["']/.test(readFileSync(f, "utf8")));
    expect(culpables).toEqual([]);
  });

  it("cada archivo que pide el layout existe y es woff2", () => {
    const rutas = [...layout.matchAll(/path:\s*"(\.\/fonts\/[^"]+)"/g)].map((m) => m[1] ?? "");
    expect(rutas).toHaveLength(6);
    for (const r of rutas) {
      const f = path.join(root, "src/app", r);
      expect(existsSync(f), r).toBe(true);
      expect(readFileSync(f).subarray(0, 4).toString("latin1"), r).toBe("wOF2");
    }
  });

  it("conserva las variables CSS de siempre", () => {
    expect(layout).toContain('variable: "--font-inter"');
    expect(layout).toContain('variable: "--font-mono"');
  });
});

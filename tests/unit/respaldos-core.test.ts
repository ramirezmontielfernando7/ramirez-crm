import { describe, expect, it } from "vitest";
import {
  aBorrar,
  assertBaseDePrueba,
  esFormatoPropio,
  libpqEnv,
  mayorDelServidor,
  nombreBasePrueba,
  nombreRespaldo,
  problemaDeVersion,
  triosCifrados,
  versionMayor,
} from "../../scripts/lib/respaldos-core.mjs";

/** Operación 1 — reglas puras de `ops/respaldo.mjs` y `ops/probar-restauracion.mjs`. */
describe("respaldos: reglas puras", () => {
  it("la URL se convierte en variables de libpq (la contraseña no va en los argumentos)", () => {
    expect(libpqEnv("postgresql://postgres:p%40ss@x1rilm10:5432/postgres?sslmode=require")).toEqual({
      PGHOST: "x1rilm10",
      PGPORT: "5432",
      PGUSER: "postgres",
      PGPASSWORD: "p@ss",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    });
    expect(() => libpqEnv("mysql://a@b/c")).toThrow();
    expect(() => libpqEnv("postgresql://a@b")).toThrow(/nombre de la base/);
  });

  it("pg_dump más viejo que el servidor se rechaza; igual o más nuevo, no", () => {
    expect(versionMayor("pg_dump (PostgreSQL) 18.6")).toBe(18);
    expect(versionMayor("pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)")).toBe(16);
    expect(mayorDelServidor("180006")).toBe(18);
    expect(problemaDeVersion(17, 18)).toMatch(/postgresql18-client/);
    expect(problemaDeVersion(18, 18)).toBeNull();
    expect(problemaDeVersion(18, 16)).toBeNull();
    expect(problemaDeVersion(null, 18)).toMatch(/pg_dump/);
  });

  it("nombres con fecha UTC y sin caracteres raros", () => {
    const f = new Date("2026-10-20T03:04:05Z");
    expect(nombreRespaldo("vocero", f)).toBe("dashfort-vocero-20261020-030405");
    expect(nombreRespaldo("mi base;rm", f)).toBe("dashfort-mi_base_rm-20261020-030405");
    expect(nombreBasePrueba(f)).toBe("vocero_prueba_restauracion_20261020_030405");
  });

  it("el candado de la base de prueba: prefijo, identificador simple y nunca producción", () => {
    expect(assertBaseDePrueba("vocero_prueba_restauracion_20261020_030405", "postgres")).toBe(
      "vocero_prueba_restauracion_20261020_030405"
    );
    expect(() => assertBaseDePrueba("postgres", "postgres")).toThrow(/no es una base de prueba/);
    expect(() => assertBaseDePrueba("vocero", "vocero")).toThrow();
    expect(() => assertBaseDePrueba('vocero_prueba_restauracion_x"; drop database postgres; --', "postgres")).toThrow(
      /no es un nombre de base válido/
    );
    expect(() => assertBaseDePrueba("vocero_prueba_restauracion_1", "vocero_prueba_restauracion_1")).toThrow(/producción/);
  });

  it("la limpieza conserva los N más nuevos y jamás toca archivos ajenos", () => {
    const archivos = [
      "dashfort-vocero-20261018-030000.dump",
      "dashfort-vocero-20261018-030000.dump.sha256",
      "dashfort-vocero-20261018-030000-media.tar.gz",
      "dashfort-vocero-20261018-030000-media.tar.gz.sha256",
      "dashfort-vocero-20261019-030000.dump",
      "dashfort-vocero-20261019-030000.dump.sha256",
      "dashfort-vocero-20261020-030000.dump",
      "dashfort-vocero-20261020-030000.dump.sha256",
      "dashfort-vocero-20261020-030000.dump.partial",
      "pg-dump-vocero-1760929200.dmp",
      "notas.txt",
    ];
    expect(aBorrar(archivos, 2)).toEqual([
      "dashfort-vocero-20261018-030000-media.tar.gz",
      "dashfort-vocero-20261018-030000-media.tar.gz.sha256",
      "dashfort-vocero-20261018-030000.dump",
      "dashfort-vocero-20261018-030000.dump.sha256",
    ]);
    expect(aBorrar(archivos, 5)).toEqual([]);
    // Los de solo archivos (tarea diaria) se cuentan aparte: no se comen las copias de la base.
    const mezcla = [
      "dashfort-vocero-20261001-030000.dump",
      "dashfort-vocero-20261018-040000-media.tar.gz",
      "dashfort-vocero-20261019-040000-media.tar.gz",
      "dashfort-vocero-20261020-040000-media.tar.gz",
    ];
    expect(aBorrar(mezcla, 2)).toEqual(["dashfort-vocero-20261018-040000-media.tar.gz"]);
    expect(() => aBorrar(archivos, 0)).toThrow();
  });

  it("reconoce el formato propio de pg_dump", () => {
    expect(esFormatoPropio(Buffer.from("PGDMP\x01\x10\x00"))).toBe(true);
    expect(esFormatoPropio(Buffer.from("-- PostgreSQL database dump"))).toBe(false);
  });

  it("encuentra los tríos cifrados solo en tablas con key_version", () => {
    expect(
      triosCifrados(["id", "key_version", "token_cipher", "token_iv", "token_tag", "webhook_secret_cipher", "webhook_secret_iv"])
    ).toEqual([{ cipher: "token_cipher", iv: "token_iv", tag: "token_tag" }]);
    expect(triosCifrados(["token_cipher", "token_iv", "token_tag"])).toEqual([]);
  });
});

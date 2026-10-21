import { describe, expect, it } from "vitest";
import {
  countVariables,
  renderBody,
  validateBodyVariables,
} from "@/server/whatsapp/templates";
import { bodyParameters, parameterFormat, variableLabel, variableNames } from "@/lib/templates";
import { checkTemplateBodyParams, mockParameterFormat } from "@/server/dev/wa-mock-template-params";

describe("countVariables / validateBodyVariables (FR-050)", () => {
  it("sin variables → 0, válido", () => {
    expect(countVariables("Hola, seguimos disponibles.")).toBe(0);
    expect(validateBodyVariables("Hola, seguimos disponibles.")).toBeNull();
  });

  it("una variable {{1}} → 1, válido (con y sin espacios)", () => {
    expect(countVariables("Hola {{1}}, ¿retomamos?")).toBe(1);
    expect(countVariables("Hola {{ 1 }}, ¿retomamos?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿retomamos?")).toBeNull();
  });

  it("varias variables numeradas en orden → válido", () => {
    const body = "Hola {{1}}, te confirmo el {{2}} a las {{3}}.";
    expect(countVariables(body)).toBe(3);
    expect(validateBodyVariables(body)).toBeNull();
  });

  it("la variable repetida cuenta una sola vez", () => {
    expect(countVariables("Hola {{1}}, ¿confirmas, {{1}}?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿confirmas, {{1}}?")).toBeNull();
  });

  it("numeración con salto → inválida", () => {
    expect(validateBodyVariables("Hola {{1}}, tu pedido {{3}} llegó")).toMatch(
      /sin saltos/
    );
  });

  it("variable {{2}} sola → inválida (debe empezar en {{1}})", () => {
    expect(validateBodyVariables("Tu pedido {{2}} llegó")).toMatch(/\{\{1\}\}/);
  });

  it("más de 10 variables → inválida", () => {
    const body = Array.from({ length: 11 }, (_, i) => `x {{${i + 1}}}`).join(" ");
    expect(validateBodyVariables(body)).toMatch(/hasta 10/);
  });
});

describe("renderBody", () => {
  it("sustituye la variable por el valor", () => {
    expect(renderBody("Hola {{1}}, ¿retomamos?", ["María"])).toBe(
      "Hola María, ¿retomamos?"
    );
  });

  it("sustituye cada variable por su posición", () => {
    expect(
      renderBody("Hola {{1}}, te espero el {{2}} a las {{3}}.", [
        "María",
        "12 de agosto",
        "5 pm",
      ])
    ).toBe("Hola María, te espero el 12 de agosto a las 5 pm.");
  });

  it("sin valores → variables vacías", () => {
    expect(renderBody("Hola {{1}}!")).toBe("Hola !");
    expect(renderBody("Hola {{1}} el {{2}}", ["María"])).toBe("Hola María el ");
  });
});

describe("variables con nombre ({{nombre}}, parameter_format NAMED)", () => {
  const named = "Hola {{nombre}}, tu cita es el {{ fecha_cita }}. Te esperamos, {{nombre}}.";
  const positional = "Hola {{1}}, te espero el {{2}}.";

  it("detecta el formato por el cuerpo", () => {
    expect(parameterFormat(named)).toBe("named");
    expect(parameterFormat(positional)).toBe("positional");
    expect(parameterFormat("Sin variables")).toBe("positional");
  });

  it("cuenta y nombra las variables en orden de primera aparición (sin repetir)", () => {
    expect(countVariables(named)).toBe(2);
    expect(variableNames(named)).toEqual(["nombre", "fecha_cita"]);
    expect(variableLabel(named, 1)).toBe("{{fecha_cita}}");
    // Las numéricas, como siempre.
    expect(variableNames(positional)).toEqual(["1", "2"]);
    expect(variableLabel(positional, 0)).toBe("{{1}}");
  });

  it("renderBody llena cada nombre en todas sus apariciones", () => {
    expect(renderBody(named, ["Ana", "lunes"])).toBe("Hola Ana, tu cita es el lunes. Te esperamos, Ana.");
    expect(renderBody(named, ["Ana"])).toBe("Hola Ana, tu cita es el . Te esperamos, Ana.");
    expect(renderBody(positional, ["Ana", "lunes"])).toBe("Hola Ana, te espero el lunes.");
  });

  it("bodyParameters: con nombre lleva parameter_name; numérica, no", () => {
    expect(bodyParameters(named, ["Ana", "lunes"])).toEqual([
      { type: "text", parameter_name: "nombre", text: "Ana" },
      { type: "text", parameter_name: "fecha_cita", text: "lunes" },
    ]);
    expect(bodyParameters(positional, ["Ana", "lunes"])).toEqual([
      { type: "text", text: "Ana" },
      { type: "text", text: "lunes" },
    ]);
  });

  it("crear desde el CRM sigue siendo numérico: una variable con nombre se rechaza con explicación", () => {
    expect(validateBodyVariables(named)).toMatch(/\{\{1\}\}/);
    expect(validateBodyVariables(positional)).toBeNull();
  });
});

describe("mock de WhatsApp: valida el formato de los parámetros como Meta", () => {
  const named = "Hola {{nombre}}, tu cita es el {{fecha_cita}}";
  it("con nombre: exige parameter_name y los nombres exactos", () => {
    expect(mockParameterFormat(named)).toBe("NAMED");
    expect(
      checkTemplateBodyParams(named, [
        { type: "text", parameter_name: "fecha_cita", text: "lunes" },
        { type: "text", parameter_name: "nombre", text: "Ana" },
      ])
    ).toBeNull();
    expect(checkTemplateBodyParams(named, [{ type: "text", text: "Ana" }, { type: "text", text: "lunes" }])).toMatch(/132000/);
    expect(checkTemplateBodyParams(named, [{ type: "text", parameter_name: "nombre", text: "Ana" }])).toMatch(/132000/);
  });
  it("numérica: cuenta como siempre y no admite parameter_name", () => {
    const positional = "Hola {{1}}, cupón {{2}}";
    expect(mockParameterFormat(positional)).toBe("POSITIONAL");
    expect(checkTemplateBodyParams(positional, [{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBeNull();
    expect(checkTemplateBodyParams(positional, [{ type: "text", text: "a" }])).toMatch(/expected 2, got 1/);
    expect(
      checkTemplateBodyParams(positional, [
        { type: "text", parameter_name: "1", text: "a" },
        { type: "text", parameter_name: "2", text: "b" },
      ])
    ).toMatch(/132000/);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "@/components/assistant/rich-text";

describe("asistente — formato de las respuestas", () => {
  it("negritas, listas y emojis; sin asteriscos sueltos", () => {
    const html = renderToStaticMarkup(createElement(RichText, { text: "Resumen **del mes** ✅\n\n- uno\n- dos con `código`\n\n1. primero\n2. segundo" }));
    expect(html).toContain("<strong");
    expect(html).toContain("del mes</strong>");
    expect(html).toContain("✅");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).not.toContain("**");
  });

  it("nunca mete HTML crudo", () => {
    const html = renderToStaticMarkup(createElement(RichText, { text: "<img src=x onerror=alert(1)> **ok**" }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

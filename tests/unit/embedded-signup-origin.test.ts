import { describe, expect, it } from "vitest";
import { readSignupMessage } from "@/components/settings/embedded-signup-card";

const popup = {} as Window;
const data = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "waba", phone_number_id: "phone" } };
function message(origin: string, source: MessageEventSource | null = popup) {
  return { origin, source, data } as MessageEvent;
}
describe("DF-17: mensajes de Embedded Signup", () => {
  it.each(["https://www.facebook.com", "https://web.facebook.com"])("acepta %s desde la ventana del intento", (origin) => {
    expect(readSignupMessage(message(origin), popup)?.kind).toBe("finish");
  });
  it.each(["https://evilfacebook.com", "https://facebook.com.evil.test", "http://www.facebook.com", "https://www.facebook.com:444", "null", "https://evil.facebook.com"])("rechaza el origen %s", (origin) => {
    expect(readSignupMessage(message(origin), popup)).toBeNull();
  });
  it("rechaza otra ventana, source nulo y mensajes fuera de un intento", () => {
    expect(readSignupMessage(message("https://www.facebook.com", {} as Window), popup)).toBeNull();
    expect(readSignupMessage(message("https://www.facebook.com", null), popup)).toBeNull();
    expect(readSignupMessage(message("https://www.facebook.com"), null)).toBeNull();
  });
  it("si no se pudo capturar el popup, basta el origen exacto (sin romper la conexión)", () => {
    expect(readSignupMessage(message("https://www.facebook.com", {} as Window), undefined)?.kind).toBe("finish");
    expect(readSignupMessage(message("https://evilfacebook.com", {} as Window), undefined)).toBeNull();
  });
});

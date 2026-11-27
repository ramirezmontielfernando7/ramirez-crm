import { expect, it } from "vitest";
import { quotePreview, validCustomerReaction } from "@/lib/customer-message-annotations";

it("accepts exactly one emoji or removal, including flags and joined emoji", () => {
  for (const value of ["", "👍🏽", "❤️", "👩‍💻", "🇲🇽", "2️⃣"]) expect(validCustomerReaction(value)).toBe(true);
  for (const value of ["a", "👍👍", " 👍", "👍\n", "1", "🇲", "<3"]) expect(validCustomerReaction(value)).toBe(false);
});

it("limits quote previews to 120 Unicode code points and supplies media labels", () => {
  expect(quotePreview("😀".repeat(130), "text")).toBe("😀".repeat(120));
  expect(quotePreview(null, "image")).toBe("Foto");
  expect(quotePreview("   ", "sticker")).toBe("Sticker");
});

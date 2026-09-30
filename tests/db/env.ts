import { randomBytes } from "node:crypto";

/**
 * Entorno de las pruebas con BD real. La base DEBE llamarse `*_test`: estas
 * pruebas crean y borran organizaciones, y un DATABASE_URL de desarrollo o de
 * producción copiado por error no puede tocarse.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("tests/db: define DATABASE_URL (una base *_test)");
const dbName = new URL(url).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test")) {
  throw new Error(`tests/db: la base "${dbName}" no termina en _test; no se toca`);
}

process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= randomBytes(24).toString("hex");
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "tok_test_" + randomBytes(8).toString("hex");
// Sin IA: la ingesta no agenda turnos del agente durante estas pruebas.
delete process.env.OPENROUTER_API_TOKEN;

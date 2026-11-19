/** Pure guard: test configuration must never reach the full CRM boot or migrator. */
export function assertFullRuntimeAllowed(environment) {
  const marker =
    environment.DASHFORT_PROFILE !== undefined ||
    environment.DASHFORT_TEST_INSTANCE !== undefined;
  const isolatedDsn = [
    "DATABASE_URL",
    "DATABASE_URL_SYSTEM",
    "DATABASE_URL_MIGRATE",
  ].some((key) => {
    try {
      const url = new URL(environment[key]);
      return (
        url.hostname === "db.i2p.invalid" ||
        url.pathname === "/dashfort_auth_test"
      );
    } catch {
      return false;
    }
  });
  if (
    marker ||
    isolatedDsn ||
    environment.APP_BASE_URL === "http://127.0.0.1:3137"
  )
    throw new Error(
      "Isolated auth preparation cannot run full CRM startup or migrations. Use only a separately reviewed test procedure.",
    );
}

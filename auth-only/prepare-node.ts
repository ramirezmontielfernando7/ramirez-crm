import { createExistingAuthHandler } from "./existing-auth";
/** Preparation factory only. Importing this module neither constructs nor starts a server.
 * Calling it and binding a port require a separate reviewed operational authorization.
 */
export async function prepareNodeServer() {
  const handler = createExistingAuthHandler(process.env);
  const [{ createServer }, { toNodeHandler }] = await Promise.all([
    import("node:http"),
    import("better-auth/node"),
  ]);
  return createServer(toNodeHandler({ handler }));
}

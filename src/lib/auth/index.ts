import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { ac, roles } from "@/lib/auth/permissions";
import { getSystemDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AUTH_RATE_LIMIT, checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  onUserCreated,
  resolveActiveOrganizationId,
} from "@/server/auth/on-signup";
import { isPublicSignupAllowed } from "@/server/auth/registration";

/**
 * Contexto interno del proceso: permite que el alta de cuentas de equipo
 * (owner → API) atraviese el gate de registro cerrado. No es alcanzable
 * desde fuera: solo envuelve llamadas server-side.
 */
const globalForSignup = globalThis as unknown as {
  __voceroInternalSignup?: AsyncLocalStorage<boolean>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<boolean> {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage<boolean>();
  }
  return globalForSignup.__voceroInternalSignup;
}

export function runInternalSignup<T>(fn: () => Promise<T>): Promise<T> {
  return internalSignupContext().run(true, fn);
}

function isInternalSignup(): boolean {
  return internalSignupContext().getStore() === true;
}

const RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/sign-up/email"]);

/**
 * H3 — Las rutas del plugin de organización (`/api/auth/organization/*`)
 * están cerradas para TODOS, Propietario incluido. Vocero no usa ninguna: el
 * alta de la organización la hace `onUserCreated` directo en la BD, la
 * organización activa la fija el hook de sesión, y el equipo, los roles y la
 * marca tienen sus propias rutas (`/api/settings/*`) con permisos, bitácora y
 * reglas de la app. Dejarlas abiertas es dejar una puerta trasera que se
 * salta todo eso (crear organizaciones, borrarlas en cascada, invitar o sacar
 * miembros).
 */
export function isOrganizationPluginPath(path: string): boolean {
  return path === "/organization" || path.startsWith("/organization/");
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Pool de sistema: better-auth resuelve usuarios y sesiones ANTES de
    // saber la organización, y escribe `member`/`invitation`.
    database: drizzleAdapter(getSystemDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    // 020: los roles de Vocero (Propietario/Coordinador/Asesor) son los del
    // control de acceso del plugin; la matriz vive en `permissions.ts`.
    //
    // H3: el plugin queda solo como modelo de datos y control de acceso.
    // Nadie crea ni borra organizaciones por su API (el hook `before` además
    // cierra todas sus rutas; esto es la segunda capa si algo las alcanza).
    plugins: [
      organization({
        creatorRole: "owner",
        ac,
        roles,
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // H3: la API del plugin de organización no la usa la app.
        if (isOrganizationPluginPath(ctx.path)) {
          throw new APIError("FORBIDDEN", {
            code: "ORGANIZATION_API_DISABLED",
            message:
              "Esta operación no está disponible; usa Ajustes para administrar el negocio y el equipo",
          });
        }
        // Rate limit por IP en login/registro (FR-062): 10 / 10 min → 429.
        if (RATE_LIMITED_PATHS.has(ctx.path)) {
          const ip = clientIp(ctx.headers);
          const result = checkRateLimit(`${ctx.path}:${ip}`, AUTH_RATE_LIMIT);
          if (!result.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos",
            });
          }
        }
        // Registro público cerrado tras la primera organización (FR-060).
        if (ctx.path === "/sign-up/email") {
          if (!isInternalSignup() && !(await isPublicSignupAllowed())) {
            throw new APIError("FORBIDDEN", {
              code: "SIGNUP_CLOSED",
              message:
                "El registro está cerrado: esta instancia ya tiene su organización",
            });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await onUserCreated(user.id, user.name);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const organizationId = await resolveActiveOrganizationId(
              session.userId
            );
            return {
              data: { ...session, activeOrganizationId: organizationId },
            };
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __voceroAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}

import { getSql, getSystemSql } from "@/lib/db";
import { APP_VERSION, resolveCommit } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // PR 3: los DOS pools (vocero_app y vocero_system). Una contraseña mal
    // puesta en cualquiera deja el contenedor sin salud y la plataforma no
    // lo pone en servicio: el anterior sigue atendiendo.
    await Promise.all([getSql()`select 1`, getSystemSql()`select 1`]);
    // La versión viaja aquí a propósito: confirmar un despliegue tiene que
    // poder hacerse con un `curl`, desde un script o desde la plataforma de
    // hosting, sin abrir la app ni iniciar sesión. Es la única forma de que un
    // pipeline pueda comprobar que el build que subió es el que corre.
    //
    // `commitVerified` dice de dónde salió `commit`: `true` si se congeló en
    // el build, `false` si es el `SOURCE_COMMIT` que la plataforma puso en el
    // entorno — que puede estar desfasado (#50). Un pipeline que compare
    // commits tiene que exigir `true`; `commit` sigue ahí igual para no romper
    // a quien ya lo lee.
    const { commit, verified } = resolveCommit();
    return Response.json({
      ok: true,
      version: APP_VERSION,
      ...(commit ? { commit, commitVerified: verified } : {}),
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}

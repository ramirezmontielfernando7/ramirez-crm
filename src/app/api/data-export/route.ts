import { apiError, withAuth } from "@/lib/api";
import { exportLock } from "@/server/data-export/guard";
import { buildDataExportStream } from "@/server/data-export/stream";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 049 — «Exportar todos mis datos»: ZIP con CSV de contactos, embudo,
 * conversaciones y mensajes. Solo el Propietario. Una exportación a la vez por
 * organización (es pesada); si hay otra en curso, 429.
 */
export const GET = withAuth(
  async (session) => {
    const release = exportLock.acquire(session.organizationId);
    if (!release) {
      return apiError(429, "export_busy", "Ya hay una exportación en curso. Espera a que termine y vuelve a intentar");
    }
    const source = buildDataExportStream(session);
    // Libera el candado cuando el flujo termina, se cancela o falla.
    const reader = source.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            release();
            controller.close();
          } else controller.enqueue(value);
        } catch (err) {
          release();
          controller.error(err);
        }
      },
      cancel(reason) {
        release();
        return reader.cancel(reason);
      },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="mis-datos-${stamp}.zip"`,
        "cache-control": "no-store",
      },
    });
  },
  { permission: "data.export" }
);

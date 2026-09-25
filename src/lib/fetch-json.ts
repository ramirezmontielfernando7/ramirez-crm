/**
 * 021 — `fetch` para la UI que NUNCA falla en silencio.
 *
 * Devuelve el dato o el mensaje de error concreto: el `error.message` que
 * manda la API (contrato api.md), o uno legible si ni siquiera hubo
 * respuesta. Quien llama decide cómo mostrarlo, pero siempre tiene algo que
 * mostrar — el patrón `.catch(() => null)` dejaba al usuario sin saber que su
 * cambio no se guardó.
 */
export type FetchResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; code: string | null; status: number };

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<FetchResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return {
      ok: false,
      error: "Sin conexión con el servidor: revisa tu internet e intenta de nuevo",
      code: "network",
      status: 0,
    };
  }
  if (res.status === 204) return { ok: true, data: undefined as T, status: 204 };
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // respuesta sin JSON (p. ej. 404 de una superficie apagada)
  }
  if (res.ok) return { ok: true, data: body as T, status: res.status };
  const apiErr = (body as { error?: { message?: string; code?: string } } | null)?.error;
  return {
    ok: false,
    error:
      apiErr?.message ??
      (res.status === 403
        ? "No tienes permiso para esta acción"
        : res.status === 404
          ? "No encontrado"
          : `Error del servidor (${res.status})`),
    code: apiErr?.code ?? null,
    status: res.status,
  };
}

/** JSON en el body con el content-type correcto. */
export function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

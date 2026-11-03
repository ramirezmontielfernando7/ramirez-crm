import type { MessageDto } from "@/lib/types";

/**
 * Auditoría DF-15 — une el bloque más reciente del hilo con lo que ya estaba
 * en pantalla. Lo anterior al bloque (pedido al subir) se conserva; del
 * bloque manda el servidor (palomitas, fallos). Si no se tocan (llegaron
 * muchos mensajes de golpe), manda el bloque nuevo.
 */
export function mergeLatest(prev: MessageDto[] | null, page: MessageDto[]): MessageDto[] {
  if (!prev || prev.length === 0 || page.length === 0) return page;
  const firstOfPage = prev.findIndex((m) => m.id === page[0]!.id);
  if (firstOfPage <= 0) return page;
  return [...prev.slice(0, firstOfPage), ...page];
}

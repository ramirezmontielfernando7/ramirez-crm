import { agentCatalog } from "../studio/model";
export const knowledgeReaders = agentCatalog;
export type KnowledgeInfo = Readonly<{
  group: string;
  reader: string | null;
  status: "indexed" | "processing" | "failed";
  source: "library" | "studio";
  readable: boolean;
}>;
export const knowledgeDefaults: KnowledgeInfo = Object.freeze({
  group: "General",
  reader: null,
  status: "indexed",
  source: "library",
  readable: true,
});
export const knowledgeStateLabel = (status: KnowledgeInfo["status"]) =>
  status === "indexed"
    ? "Indexado"
    : status === "processing"
      ? "Procesando…"
      : "No se pudo leer";
export const knowledgeReaderLabel = (id: string | null) =>
  knowledgeReaders.find((r) => r.id === id)?.name ?? "Todos los agentes";

export function utf8Size(text: string) {
  let count = 0;
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    count += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  return count;
}

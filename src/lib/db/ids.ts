import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  member: "mem",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  leadStageEvent: "lse",
  credentials: "cred",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  testRun: "run",
  testCase: "case",
  mediaAsset: "ma",
  // 015 — motor de agenda
  calendarSettings: "cal",
  booking: "bk",
  offeredSlot: "ofs",
  zoomCredentials: "zcred",
  googleCredentials: "gcred",
  // 016 — atribución de anuncios
  adAttribution: "att",
  conversionEvent: "cve",
  capiSettings: "capi",
  // 020 — roles y asignación
  assignmentEvent: "cae",
  salesTeam: "team",
  assignmentBatch: "batch",
  // 021 — etiquetas y campañas
  contactTag: "tag",
  campaign: "cmp",
  campaignRecipient: "cmr",
  // 022 — línea de tiempo del chat
  activityEvent: "act",
  // 024 — Conocimientos
  knowledgeEntry: "kn",
  // 025 — chat de equipo
  teamChatThread: "tct",
  teamChatMessage: "tcm",
  teamChatAttachment: "tca",
  // 026 — participantes de chats de cliente
  participantEvent: "cpe",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}

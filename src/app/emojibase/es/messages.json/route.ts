import messages from "emojibase-data/es/messages.json";

/** Nombres de categorías y tonos del selector de emojis (ver `data.json`). */
export const dynamic = "force-static";

export function GET() {
  return Response.json(messages);
}

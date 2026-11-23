-- C11. La misma fila conserva las bajas y los eventos entrantes ya vistos.
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "reply_to_wa_message_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_reaction" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "direction" text NOT NULL CHECK ("direction" IN ('in', 'out')),
  "emoji" text NOT NULL,
  "wa_reaction_message_id" text UNIQUE,
  "seen_wa_ids" text[] NOT NULL DEFAULT '{}',
  "event_at" timestamp,
  "pending_emoji" text,
  "pending_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "message_reaction_message_direction_uq" UNIQUE ("message_id", "direction"),
  CONSTRAINT "message_reaction_org_message_fk" FOREIGN KEY ("organization_id", "message_id")
    REFERENCES "message"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "message_reaction_org_conv_fk" FOREIGN KEY ("organization_id", "conversation_id")
    REFERENCES "conversation"("organization_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_reaction_org_conv_idx"
  ON "message_reaction" ("organization_id", "conversation_id", "message_id");
--> statement-breakpoint
ALTER TABLE "message_reaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_reaction" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "aislamiento_por_organizacion" ON "message_reaction";
--> statement-breakpoint
CREATE POLICY "aislamiento_por_organizacion" ON "message_reaction"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));

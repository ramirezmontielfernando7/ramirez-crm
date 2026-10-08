-- 035 — Documentos del negocio que lee el agente (RAG ligero).
--
-- `kb_document`: un documento subido en Laboratorio → Documentos. Se guarda
-- SOLO su texto extraído (para reindexar si cambia el modelo de embeddings);
-- el archivo original no. `content_sha256` único por organización: el mismo
-- archivo no se sube dos veces.
-- `kb_chunk`: sus fragmentos, con `tsv` (búsqueda por texto en español,
-- columna generada) y `embedding real[]` (NULL = solo texto). Sin pgvector a
-- propósito: la imagen de Postgres de producción y la del CI no la traen, y
-- con los límites de 035 (≤ 3 000 fragmentos por organización) el coseno se
-- calcula en Node sin problema.
-- `kb_document_limit`: límites propios de una organización (NULL o sin fila =
-- los del entorno). La edita el operador (scripts/kb-limits.mjs).
--
-- FK compuesta (misma organización) de fragmento → documento, con CASCADE:
-- borrar el documento borra sus fragmentos. Tablas de dominio con RLS forzado
-- (política de la 0027).
--
-- Solo aditiva: el código anterior ignora las tablas nuevas, así que revertir
-- es volver a desplegar la imagen anterior. Limpieza opcional:
-- scripts/sql/0040-reversa.sql. Idempotente: re-ejecutable sobre una base ya
-- migrada.
CREATE TABLE IF NOT EXISTS "kb_document" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" integer NOT NULL,
	"char_count" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"embedding_model" text,
	"uploaded_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"indexed_at" timestamp,
	CONSTRAINT "kb_document_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "kb_document_org_sha_uq" UNIQUE("organization_id","content_sha256"),
	CONSTRAINT "kb_document_mime_chk" CHECK ("kb_document"."mime" in ('text/plain', 'text/markdown', 'application/pdf')),
	CONSTRAINT "kb_document_status_chk" CHECK ("kb_document"."status" in ('pending', 'processing', 'ready', 'failed')),
	CONSTRAINT "kb_document_title_chk" CHECK (char_length("kb_document"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"document_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	-- Sin acentos (casi nadie los escribe en WhatsApp); la ñ se conserva.
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('spanish'::regconfig, translate("content", 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'))) STORED,
	"embedding" real[],
	"embedding_model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunk_doc_ordinal_uq" UNIQUE("organization_id","document_id","ordinal"),
	CONSTRAINT "kb_chunk_content_chk" CHECK (char_length("kb_chunk"."content") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_document_limit" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"max_file_bytes" integer,
	"max_documents" integer,
	"max_chunks" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kb_chunk" ADD CONSTRAINT "kb_chunk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- FK compuesta: un fragmento de A jamás cuelga de un documento de B.
DO $$ BEGIN
	ALTER TABLE "kb_chunk" ADD CONSTRAINT "kb_chunk_org_document_fk" FOREIGN KEY ("organization_id","document_id") REFERENCES "public"."kb_document"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kb_document_limit" ADD CONSTRAINT "kb_document_limit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_chunk_tsv_idx" ON "kb_chunk" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_document_org_status_idx" ON "kb_document" USING btree ("organization_id","status");--> statement-breakpoint
-- RLS de las tablas de dominio nuevas (misma política que la 0027).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kb_document', 'kb_chunk', 'kb_document_limit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aislamiento_por_organizacion ON %I', t);
    EXECUTE format(
      'CREATE POLICY aislamiento_por_organizacion ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t
    );
  END LOOP;
END
$$;

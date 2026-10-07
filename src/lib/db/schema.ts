import {
  boolean,
  date,
  foreignKey,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Tiempo: todas las columnas son `timestamp without time zone` y el marco es
 * UTC. Drizzle lo respeta en ambas direcciones; `now()` de los `defaultNow()`
 * solo lo respeta porque la conexión fija `TimeZone: "UTC"`
 * (ver src/lib/db/index.ts). No cambies una columna a `timestamptz` de forma
 * aislada: al leerla Drizzle seguiría añadiéndole "+0000" salvo que también
 * lleve `{ withTimezone: true }`.
 */

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    metadata: text("metadata"),
    /**
     * Fase 3, PR 2 — Estado de la organización, lo cambia SOLO el
     * administrador de plataforma (`src/server/platform/`):
     * `active` · `suspended` (sus usuarios no entran, sus webhooks van a
     * `webhook_unrouted`, no se envía nada) · `deleted` (borrado suave: igual
     * que suspendida, y `purge_after` dice desde cuándo se puede borrar de
     * verdad con `scripts/purge-organization.mjs`).
     */
    status: text("status", { enum: ["active", "suspended", "deleted"] })
      .notNull()
      .default("active"),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at"),
    deletedAt: timestamp("deleted_at"),
    purgeAfter: timestamp("purge_after"),
    /**
     * Fase 3, PR 3 — Organización "madre", opcional. Queda lista para la
     * reventa por agencias (una agencia con sus clientes); hoy NADA la lee ni
     * la escribe. `restrict`: no se borra una madre con hijas colgando.
     */
    parentId: text("parent_id").references((): AnyPgColumn => organization.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    check("organization_status_chk", sql`${t.status} in ('active', 'suspended', 'deleted')`),
    index("organization_parent_idx").on(t.parentId),
    check("organization_parent_not_self_chk", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ]
);

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /**
   * 020: `owner` (Propietario) · `coordinador` · `asesor`. Texto libre en BD
   * a propósito (lo exige better-auth); lo que vale cada rol lo decide
   * `src/lib/auth/permissions.ts`, y un rol desconocido no puede nada.
   */
  role: text("role").notNull().default("asesor"),
  /**
   * 020: equipo de ventas del miembro. Esquema listo, sin interfaz todavía:
   * NULL = sin equipo, que es lo que tienen todas las instancias hoy.
   */
  salesTeamId: text("sales_team_id").references(() => salesTeam.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Fase 1 (H20): el equipo de una organización (Ajustes → Equipo, reparto)
  // y la membresía de un usuario dentro de ella.
  index("member_org_user_idx").on(t.organizationId, t.userId),
  // resolveMembership (H4): la sesión busca la membresía del usuario, la
  // más antigua primero, antes de saber su organización.
  index("member_user_created_idx").on(t.userId, t.createdAt),
]);

/**
 * 020 — Equipo de ventas: un coordinador por equipo. Solo esquema; la interfaz
 * llega después. Vive aparte del `team` de better-auth a propósito: aquel
 * cambia la sesión (`activeTeamId`) y no sabe nada de coordinadores.
 */
export const salesTeam = pgTable(
  "sales_team",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    coordinatorUserId: text("coordinator_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("sales_team_org_idx").on(t.organizationId)]
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
}, (t) => [
  // Fase 1 (H20): la app no usa invitaciones todavía (Fase 3), pero el
  // filtro por organización es el que aplicará RLS en el PR 4.
  index("invitation_org_idx").on(t.organizationId),
]);

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Llave de resolución WhatsApp (003): teléfono normalizado (521→52) o
     * `bsuid:<id>` cuando Meta no manda wa_id. Estable de por vida.
     */
    /**
     * 014: canal por el que vive este contacto. Aditivo y con default: toda
     * fila existente sigue significando exactamente lo mismo.
     */
    channel: text("channel", { enum: ["whatsapp", "instagram", "messenger"] })
      .notNull()
      .default("whatsapp"),
    /**
     * Llave de resolucion. WhatsApp: telefono normalizado (521 a 52) o
     * `bsuid:<id>`. Instagram (014): `ig:<IGSID>`. Estable de por vida.
     * El nombre `wa_identity` se conserva porque es contrato publicado:
     * `/api/bot/context?waIdentity=...` lo recibe y lo devuelve, y hay
     * cerebros externos que dependen de el.
     */
    waIdentity: text("wa_identity").notNull(),
    /** Teléfono como ATRIBUTO opcional (003): falta en contactos BSUID. */
    phone: text("phone"),
    /** Business-Scoped User ID si se conoce (003). */
    waUserId: text("wa_user_id"),
    name: text("name").notNull(),
    /**
     * Quién puso este nombre.
     *
     * `perfil` = lo trajo WhatsApp y puede seguir actualizandose solo;
     * `manual` = lo escribio una persona en el CRM y NADIE lo pisa.
     *
     * Existe porque las dos cosas se necesitan a la vez: un contacto que
     * cambia su nombre de WhatsApp tiene que reflejarse (#51), y el operador
     * que renombro a alguien como "Juan - obra Polanco" no puede perder ese
     * trabajo con el siguiente mensaje.
     */
    nameSource: text("name_source", { enum: ["perfil", "manual"] })
      .notNull()
      .default("perfil"),
    notes: text("notes"),
    /**
     * Ficha de calificación que levanta un cerebro externo por
     * `PUT /api/bot/ficha`. Es un objeto libre a propósito: los datos que
     * importan de un lead los define cada negocio (una clínica querrá
     * "tratamiento", una constructora "metros"), y cablearlos como columnas
     * obligaría a migrar el CRM cada vez que alguien cambia su cuestionario.
     * Merge campo a campo; `null` explícito borra la clave.
     */
    ficha: jsonb("ficha").$type<Record<string, unknown>>(),
    /**
     * De dónde salió el prospecto. NULL = nadie la capturó, y entonces la API
     * la deduce. Así no hace falta backfill ni marcar en falso los contactos
     * que ya existían.
     */
    source: text("source", {
      enum: ["anuncio", "organico", "referido", "conocido", "otro"],
    }),
    archivedAt: timestamp("archived_at"),
    /**
     * 021: ¿aceptó este contacto recibir mensajes masivos por WhatsApp?
     *
     * `desconocido` es el default de TODO contacto (existente, del webhook o
     * importado) porque nadie ha verificado nada. Las campañas solo pueden
     * apuntar a `opt_in` — regla dura en el servidor, no un aviso visual
     * (ver `src/server/campaigns/audience.ts`). Un `opt_out` es pegajoso:
     * ninguna importación lo revierte, solo una persona a mano.
     */
    waConsent: text("wa_consent", {
      enum: ["opt_in", "opt_out", "desconocido"],
    })
      .notNull()
      .default("desconocido"),
    /** 021: de dónde salió ese consentimiento ("formulario web", "importado…"). */
    waConsentSource: text("wa_consent_source"),
    /** 021: cuándo cambió por última vez (auditoría). NULL = nunca se tocó. */
    waConsentAt: timestamp("wa_consent_at"),
    /**
     * 020: quién del equipo atiende a este contacto (su lead, su conversación
     * y sus citas). NULL = sin asignar, que es como nace todo lead.
     *
     * Regla dura: la ÚNICA puerta que escribe esta columna es
     * `src/server/assignment/assign.ts`, que a la vez anota el movimiento en
     * `contact_assignment_event`. Un test de vigilancia lo exige.
     */
    assignedUserId: text("assigned_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at"),
    /**
     * Campañas v2 (PR 2): correo OPCIONAL, solo como atributo (Vocero no
     * envía correos). No es único: dos contactos pueden compartirlo. Lo
     * llena la importación de audiencias sin pisar un valor existente.
     */
    email: text("email"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("contact_org_assigned_idx").on(t.organizationId, t.assignedUserId),
    index("contact_org_email_idx").on(t.organizationId, sql`lower(${t.email})`),
    // 014: el canal entra en la llave. Sin el, un IGSID que coincidiera con
    // un telefono normalizado mezclaria dos personas en silencio.
    uniqueIndex("contact_org_channel_identity_uq").on(
      t.organizationId,
      t.channel,
      t.waIdentity
    ),
    index("contact_org_wa_user_id_idx").on(t.organizationId, t.waUserId),
    index("contact_org_name_idx").on(t.organizationId, t.name),
    index("contact_org_consent_idx").on(t.organizationId, t.waConsent),
    unique("contact_org_id_uq").on(t.organizationId, t.id),
  ]
);

/* ============================================================
 * 021 — Etiquetas de contacto
 * ============================================================ */

/**
 * Etiqueta del negocio ("VIP", "Import: clientes-marzo.csv"…). El nombre es
 * único por organización: importar dos veces el mismo archivo reusa la misma
 * etiqueta en vez de duplicarla.
 */
export const contactTag = pgTable(
  "contact_tag",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Color de la paleta de la UI (`TAG_COLORS` de lib/tags.ts). NULL = neutro. */
    color: text("color"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_tag_org_name_uq").on(t.organizationId, t.name),
    unique("contact_tag_org_id_uq").on(t.organizationId, t.id),
  ]
);

/**
 * Qué contacto lleva qué etiqueta. Cascada en los DOS lados: borrar una
 * etiqueta borra sus asignaciones (nunca los contactos) y borrar un contacto
 * se lleva sus etiquetas.
 */
export const contactTagAssignment = pgTable(
  "contact_tag_assignment",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull(),
    tagId: text("tag_id")
      .notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.tagId] }),
    index("contact_tag_assignment_org_tag_idx").on(t.organizationId, t.tagId),
    // Fase 1 (H6): el contacto es de la MISMA organización
    foreignKey({
      name: "contact_tag_assignment_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
    // Fase 1 (H6): la etiqueta es de la MISMA organización
    foreignKey({
      name: "contact_tag_assignment_org_tag_fk",
      columns: [t.organizationId, t.tagId],
      foreignColumns: [contactTag.organizationId, contactTag.id],
    }).onDelete("cascade"),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stage_org_pos_idx").on(t.organizationId, t.position),
    unique("pipeline_stage_org_id_uq").on(t.organizationId, t.id),
  ]
);

export const lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull(),
    stageId: text("stage_id")
      .notNull(),
    position: integer("position").notNull().default(0),
    /**
     * Monto de la negociación en CENTAVOS ENTEROS. NULL = nadie lo capturó, que
     * no es lo mismo que cero: un trato sin monto no vale $0, simplemente no se
     * sabe, y el tablero lo dice con palabras en vez de sumar un cero.
     */
    amountCents: integer("amount_cents"),
    /** Moneda del monto; la del negocio al capturarlo (Ajustes → Marca). */
    currency: text("currency"),
    /**
     * Prioridad de cierre. NULL = nadie la ha decidido, que NO es lo mismo que
     * "media": nada la escribe automáticamente, así que el dueño puede confiar
     * en que lo que ve es lo que él puso.
     */
    priority: text("priority", { enum: ["alta", "media", "baja"] }),
    priorityUpdatedAt: timestamp("priority_updated_at"),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
    unique("lead_org_id_uq").on(t.organizationId, t.id),
    // Fase 1 (H6): el contacto es de la MISMA organización
    foreignKey({
      name: "lead_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
    // Fase 1 (H6): la etapa es de la MISMA organización
    foreignKey({
      name: "lead_org_stage_fk",
      columns: [t.organizationId, t.stageId],
      foreignColumns: [pipelineStage.organizationId, pipelineStage.id],
    }).onDelete("no action"),
  ]
);

/**
 * Bitácora de movimientos de etapa: append-only. Nada se actualiza ni se borra;
 * corregir un dato es agregar un movimiento nuevo.
 *
 * Es el cimiento de todo lo histórico: sin ella el CRM solo sabe dónde está
 * cada lead HOY, y "¿cuánto cerré en julio?" no tiene respuesta.
 *
 * Regla dura: la ÚNICA puerta que escribe aquí —y que escribe `lead.stage_id`—
 * es `src/server/leads/stage-history.ts`. Un unit test de vigilancia falla si
 * aparece otra escritura, porque un camino que mueva el lead sin registrar el
 * evento no truena: solo hace que las gráficas mientan meses después.
 */
export const leadStageEvent = pgTable(
  "lead_stage_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull(),
    /** Denormalizado a propósito: casi toda agregación cruza con el contacto,
     *  y el join extra se pagaría en cada consulta. */
    contactId: text("contact_id")
      .notNull(),
    /** NULL = el lead nació en `toStage` (evento de creación). */
    fromStageId: text("from_stage_id"),
    fromStageName: text("from_stage_name"),
    toStageId: text("to_stage_id"),
    /** Snapshots: sobreviven al renombre y al borrado de la etapa, para que
     *  reorganizar el tablero de hoy no reescriba el embudo del pasado. */
    toStageName: text("to_stage_name").notNull(),
    toStageKind: text("to_stage_kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    /** Cuándo PASÓ (no cuándo se registró). */
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    /** NULL = no lo movió una persona (bot, sistema, migración). */
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    source: text("source", {
      enum: ["dueno", "bot", "sistema", "migracion"],
    })
      .notNull()
      .default("dueno"),
    /** true = fecha SEMBRADA en la migración, no observada. Cuenta para los
     *  totales pero jamás para promedios de tiempo. */
    approximate: boolean("approximate").notNull().default(false),
    lossReason: text("loss_reason", {
      enum: [
        "precio",
        "no_es_perfil",
        "sin_presupuesto",
        "eligio_otro",
        "nunca_contesto",
        "otro",
      ],
    }),
    lossNote: text("loss_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("lse_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("lse_lead_occurred_idx").on(t.leadId, t.occurredAt),
    index("lse_org_kind_occurred_idx").on(
      t.organizationId,
      t.toStageKind,
      t.occurredAt
    ),
    // Perder un trato sin motivo es imposible a nivel de BASE, no por
    // disciplina de cada ruta. La excepción es la siembra de la migración: no
    // puede inventar un motivo que nadie capturó.
    check(
      "lse_loss_reason_ck",
      sql`${t.toStageKind} <> 'lost' OR ${t.approximate} = true OR ${t.lossReason} IS NOT NULL`
    ),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "lead_stage_event_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "lead_stage_event_org_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }).onDelete("cascade"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (from_stage_id) (0025)
    foreignKey({
      name: "lead_stage_event_org_from_stage_fk",
      columns: [t.organizationId, t.fromStageId],
      foreignColumns: [pipelineStage.organizationId, pipelineStage.id],
    }).onDelete("set null"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (to_stage_id) (0025)
    foreignKey({
      name: "lead_stage_event_org_to_stage_fk",
      columns: [t.organizationId, t.toStageId],
      foreignColumns: [pipelineStage.organizationId, pipelineStage.id],
    }).onDelete("set null"),
  ]
);

/**
 * 020 — Bitácora de asignaciones: append-only, mismo contrato que
 * `lead_stage_event`. Responde "¿quién tenía este lead, desde cuándo y quién
 * lo reasignó?". La única puerta que escribe aquí es
 * `src/server/assignment/assign.ts`.
 */
export const contactAssignmentEvent = pgTable(
  "contact_assignment_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull(),
    /** Denormalizado para cruzar con el embudo sin otro join. */
    leadId: text("lead_id"),
    /** NULL = estaba sin asignar. */
    fromUserId: text("from_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** NULL = quedó sin asignar. */
    toUserId: text("to_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Quién lo reasignó; NULL = no fue una persona. */
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** `auto` queda reservado para el reparto automático (round-robin). */
    source: text("source", {
      enum: ["manual", "lote", "auto", "sistema", "migracion"],
    })
      .notNull()
      .default("manual"),
    reason: text("reason"),
    /** Agrupa los movimientos de una misma reasignación en lote. */
    batchId: text("batch_id"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("cae_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("cae_contact_occurred_idx").on(t.contactId, t.occurredAt),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "contact_assignment_event_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (lead_id) (0025)
    foreignKey({
      name: "contact_assignment_event_org_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }).onDelete("set null"),
  ]
);

/**
 * 026 — Participantes de un chat de cliente: asesores que TAMBIÉN lo ven y lo
 * atienden, además del asignado. La asignación principal
 * (`contact.assigned_user_id`) sigue siendo la única fuente de verdad de
 * "de quién es"; esto es un concepto aparte. La única puerta que escribe aquí
 * es `src/server/assignment/participants.ts`. `scopedContacts()` los incluye.
 */
export const contactParticipant = pgTable(
  "contact_participant",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    addedByUserId: text("added_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.userId] }),
    // `scopedContacts` hace un EXISTS por (contacto, usuario) en cada consulta
    // de la Bandeja; la PK lo cubre. Este cubre "¿dónde participo?".
    index("contact_participant_org_user_idx").on(t.organizationId, t.userId),
    // Fase 1 (H6): el contacto es de la MISMA organización
    foreignKey({
      name: "contact_participant_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
  ]
);

/** 026 — Bitácora de participantes (append-only): quién entró/salió, quién lo hizo. */
export const contactParticipantEvent = pgTable(
  "contact_participant_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action", { enum: ["added", "removed"] }).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("cpe_contact_occurred_idx").on(t.contactId, t.occurredAt),
    index("cpe_org_occurred_idx").on(t.organizationId, t.occurredAt),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "contact_participant_event_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
  ]
);

/**
 * 020 — Cómo se reparten los leads nuevos. Reservado: hoy solo existe
 * `manual` (llegan sin asignar). El round-robin leerá `mode` y avanzará
 * `cursor_user_id`; ver `src/server/assignment/strategy.ts`.
 */
export const assignmentSettings = pgTable("assignment_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  mode: text("mode", { enum: ["manual", "round_robin"] })
    .notNull()
    .default("manual"),
  cursorUserId: text("cursor_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull(),
    /** Conversación del Laboratorio: jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    /**
     * 014: canal de la conversacion. Denormalizado del contacto a proposito:
     * el ruteo de salida y el filtro de la bandeja lo leen en cada mensaje.
     */
    channel: text("channel", { enum: ["whatsapp", "instagram", "messenger"] })
      .notNull()
      .default("whatsapp"),
    /**
     * 014: identificador del hilo en la plataforma de origen. Zernio entrega
     * un conversationId opaco ("no asumas su formato") que hace falta para
     * responder; WhatsApp no lo necesita y queda null.
     */
    channelThreadRef: text("channel_thread_ref"),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      // 008: manual_reply = el dueño respondió desde la app del teléfono.
      // hostilidad = el lead se puso agresivo y el agente se retiró.
      enum: [
        "cliente",
        "modelo",
        "error",
        "ventana",
        "hostilidad",
        "manual_reply",
        // Fase 3: la organización agotó su cuota mensual de IA.
        "cuota",
      ],
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    /**
     * 031 (PR B): el agente que respondió el último turno real. NULL = aún
     * ninguno. Solo lo escribe el turno (`src/server/agents/handover.ts`);
     * cuando cambia se anota `agent_changed` en la línea de tiempo.
     */
    lastAgentId: text("last_agent_id"),
    /**
     * 034: archivada = fuera de la Bandeja principal, pero conservada. NULL =
     * a la vista. Un mensaje entrante la desarchiva. (No confundir con
     * `contact.archived_at`, que archiva al contacto.)
     */
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
    index("conversation_org_archived_idx").on(t.organizationId, t.archivedAt),
    unique("conversation_org_id_uq").on(t.organizationId, t.id),
    // Fase 1 (H6): el contacto es de la MISMA organización
    foreignKey({
      name: "conversation_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
    // 031 (PR B). En la BD es ON DELETE SET NULL (last_agent_id) (0036).
    foreignKey({
      name: "conversation_org_last_agent_fk",
      columns: [t.organizationId, t.lastAgentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("set null"),
  ]
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull(),
    /** ID de WhatsApp — UNIQUE (idempotencia). Nullable en salientes de prueba. */
    waMessageId: text("wa_message_id").unique(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    /**
     * 008 — Origen del saliente: IA (bot), operador del CRM, manual desde la
     * app de WhatsApp Business del teléfono (echo), o plantilla. En entrantes
     * queda el default y la UI lo ignora.
     */
    origin: text("origin", {
      enum: ["ai", "operator", "manual", "template"],
    })
      .notNull()
      .default("operator"),
    /** 008 — Adjunto del mensaje (imagen, doc, ubicación…), si lo hay. */
    mediaAssetId: text("media_asset_id"),
    waTimestamp: timestamp("wa_timestamp"),
    /**
     * Campañas v2 (PR 1) — hora de cada estado, según el `timestamp` que
     * manda Meta. Se guarda una sola vez cada una (la primera gana) y aunque
     * lleguen fuera de orden: un `delivered` que llega después del `read`
     * no cambia el estado, pero sí deja su hora. Ver `src/server/inbox/status.ts`.
     */
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    failedAt: timestamp("failed_at"),
    /** Código numérico del error de Meta (131049, 131026…); `error` lleva su traducción. */
    errorCode: integer("error_code"),
    /**
     * Objeto `pricing` del webhook de estados, tal como lo manda Meta (no se
     * deduce: las reglas de cobro cambian). NULL = Meta no lo reportó.
     */
    pricingBillable: boolean("pricing_billable"),
    pricingCategory: text("pricing_category"),
    pricingModel: text("pricing_model"),
    pricingType: text("pricing_type"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Campañas v2: destino de la FK compuesta de campaign_recipient.
    unique("message_org_id_uq").on(t.organizationId, t.id),
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
    // Fase 1 (H6): la conversación es de la MISMA organización
    foreignKey({
      name: "message_org_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversation.organizationId, conversation.id],
    }).onDelete("cascade"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (media_asset_id): drizzle no sabe escribir la lista de columnas (0024)
    foreignKey({
      name: "message_org_media_asset_fk",
      columns: [t.organizationId, t.mediaAssetId],
      foreignColumns: [mediaAsset.organizationId, mediaAsset.id],
    }).onDelete("set null"),
  ]
);


/**
 * PR 1 Fase 3 (H8) — De qué organización es cada WABA. `waba_id` es ÚNICO en
 * la instancia: los eventos a nivel WABA (plantillas, `account_update`) se
 * enrutan por aquí sin "la primera organización que lo tenga". Una WABA puede
 * tener varios números; el esquema lo admite (cada número es una fila de
 * `meta_credentials` que cuelga de su WABA), aunque hoy sea uno por
 * organización.
 */
export const whatsappBusinessAccount = pgTable(
  "whatsapp_business_account",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_business_account_waba_uq").on(t.wabaId),
    // Destino de la FK compuesta de meta_credentials; empieza por la organización.
    unique("whatsapp_business_account_org_waba_uq").on(t.organizationId, t.wabaId),
  ]
);

/**
 * 008 — Adjuntos: archivo (imagen/video/audio/documento/sticker) copiado al
 * volumen local (`MEDIA_DIR`) o contenido estructurado (location/contacts) en
 * `payload`. Meta expira sus archivos (~30 días): el disco propio es la
 * fuente durable (constitución II: sin S3/R2).
 */
export const mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "image",
        "video",
        "audio",
        "document",
        "sticker",
        "location",
        "contacts",
      ],
    }).notNull(),
    /** media id de Graph (entrantes/salientes subidos); NULL en location/contacts. */
    waMediaId: text("wa_media_id"),
    mimeType: text("mime_type"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    caption: text("caption"),
    /** location {latitude, longitude, name?, address?} o contacts (subset). */
    payload: jsonb("payload"),
    /** Ruta relativa dentro de MEDIA_DIR; NULL si aún no descargado o no aplica. */
    storagePath: text("storage_path"),
    fetchStatus: text("fetch_status", {
      enum: ["available", "pending", "failed"],
    })
      .notNull()
      .default("pending"),
    fetchError: text("fetch_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("media_asset_org_idx").on(t.organizationId, t.createdAt),
    index("media_asset_wa_media_idx").on(t.waMediaId),
    unique("media_asset_org_id_uq").on(t.organizationId, t.id),
  ]
);

export const metaCredentials = pgTable(
  "meta_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * PR 1 Fase 3 — con qué versión de ENCRYPTION_KEY está cifrado lo de esta
     * fila (`src/server/credentials/`). La rotación la sube al arrancar.
     */
    keyVersion: integer("key_version").notNull().default(1),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Un número por organización POR AHORA (decisión de la Fase 3). Para
    // varios números basta con quitar este índice: la WABA ya es de UNA
    // organización por `whatsapp_business_account`.
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    // El webhook enruta por phone_number_id: debe ser único en la instancia.
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
    // H8: la WABA declarada es de ESTA organización (y de ninguna otra).
    foreignKey({
      name: "meta_credentials_org_waba_fk",
      columns: [t.organizationId, t.wabaId],
      foreignColumns: [whatsappBusinessAccount.organizationId, whatsappBusinessAccount.wabaId],
    }),
  ]
);

/**
 * 014 - Credenciales del canal de Instagram. Tabla explicita (no un jsonb
 * generico) porque unas credenciales tienen forma fija y conocida: asi
 * conservan tipado e indices. El token se cifra con los mismos helpers que el
 * de WhatsApp; un segundo mecanismo de cifrado seria un segundo mecanismo que
 * auditar.
 */
export const instagramCredentials = pgTable(
  "instagram_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** De donde vienen los mensajes: API unificada o app propia de Meta. */
    source: text("source", { enum: ["zernio", "meta"] }).notNull(),
    /** IG_ID del perfil profesional: por el enruta el webhook. */
    igUserId: text("ig_user_id").notNull(),
    /** Zernio: accountId de la cuenta conectada. Meta directo: null. */
    accountRef: text("account_ref"),
    username: text("username"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * Secreto HMAC de las entregas (Zernio) EN CLARO: obsoleto desde la 0028.
     * El arranque lo pasa a `webhook_secret_cipher` y lo deja en NULL
     * (`src/server/credentials/maintenance.ts`). Nadie lo escribe ya.
     */
    webhookSecret: text("webhook_secret"),
    /** Secreto HMAC de las entregas (Zernio), cifrado; null en modo Meta. */
    webhookSecretCipher: text("webhook_secret_cipher"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    /**
     * PR 1 Fase 3 — con qué versión de ENCRYPTION_KEY está cifrado lo de esta
     * fila (`src/server/credentials/`). La rotación la sube al arrancar.
     */
    keyVersion: integer("key_version").notNull().default(1),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instagram_credentials_org_uq").on(t.organizationId),
    uniqueIndex("instagram_credentials_ig_user_uq").on(t.igUserId),
    index("instagram_credentials_account_ref_idx").on(t.accountRef),
  ]
);

/**
 * 017 — Credenciales del canal de Messenger: la página de Facebook y su token
 * de acceso, cifrado con el mismo AES-256-GCM que los demás. Tabla propia y
 * explícita, como la de Instagram: unas credenciales tienen forma fija y
 * conocida, y esconderlas en un jsonb perdería el tipado y los índices.
 */
export const messengerCredentials = pgTable(
  "messenger_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** De donde vienen los mensajes: API unificada o app propia de Meta. */
    source: text("source", { enum: ["zernio", "meta"] })
      .notNull()
      .default("meta"),
    /**
     * ID de la página de Facebook: por él enruta el webhook de Meta
     * (`entry[].id`). En modo Zernio puede no conocerse — ahí enruta
     * `account_ref` — así que es opcional.
     */
    pageId: text("page_id"),
    pageName: text("page_name"),
    /** Zernio: accountId de la cuenta conectada. Meta directo: null. */
    accountRef: text("account_ref"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * Secreto HMAC de las entregas (Zernio) EN CLARO: obsoleto desde la 0028.
     * El arranque lo pasa a `webhook_secret_cipher` y lo deja en NULL
     * (`src/server/credentials/maintenance.ts`). Nadie lo escribe ya.
     */
    webhookSecret: text("webhook_secret"),
    /** Secreto HMAC de las entregas (Zernio), cifrado; null en modo Meta. */
    webhookSecretCipher: text("webhook_secret_cipher"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    /**
     * PR 1 Fase 3 — con qué versión de ENCRYPTION_KEY está cifrado lo de esta
     * fila (`src/server/credentials/`). La rotación la sube al arrancar.
     */
    keyVersion: integer("key_version").notNull().default(1),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messenger_credentials_org_uq").on(t.organizationId),
    uniqueIndex("messenger_credentials_page_uq").on(t.pageId),
    index("messenger_credentials_account_ref_idx").on(t.accountRef),
  ]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: text("name").notNull().default("Asistente"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);

/**
 * 031 — Agentes de IA de una organización (Laboratorio como Centro de
 * Agentes). Una fila por identidad, incluido el agente GENERAL (máx. uno no
 * archivado por organización: `agent_general_uq`). La configuración vive en
 * dos JSON con la forma de `agentConfigSchema` (src/server/agents/config.ts):
 * `draft` (lo que se edita) y `published` (lo que atiende en producción).
 * Única puerta: src/server/agents/. `agent_profile` se conserva como dueño
 * del interruptor global y espejo del general publicado (`mirror.ts`).
 */
export const agent = pgTable(
  "agent",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    internalName: text("internal_name").notNull(),
    isGeneral: boolean("is_general").notNull().default(false),
    draft: jsonb("draft").notNull(),
    /** NULL = nunca publicado. El general siempre tiene uno. */
    published: jsonb("published"),
    publishedAt: timestamp("published_at"),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("agent_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("agent_general_uq")
      .on(t.organizationId)
      .where(sql`${t.isGeneral} and ${t.archivedAt} is null`),
    index("agent_org_idx").on(t.organizationId, t.createdAt),
    check("agent_internal_name_chk", sql`char_length(${t.internalName}) between 1 and 60`),
    check("agent_draft_chk", sql`jsonb_typeof(${t.draft}) = 'object'`),
    check("agent_published_chk", sql`${t.published} is null or jsonb_typeof(${t.published}) = 'object'`),
  ]
);

/**
 * 031 — Versiones publicadas de cada agente (append-only, últimas 30 por
 * agente). `snapshot` es la config tal como quedó; restaurar la carga al
 * BORRADOR, nunca a producción.
 */
export const agentPublishLog = pgTable(
  "agent_publish_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    action: text("action", { enum: ["publish", "restore", "legacy_put", "make_general"] }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => [
    index("agent_publish_log_agent_at_idx").on(t.organizationId, t.agentId, t.at),
    check("agent_publish_log_action_chk", sql`${t.action} in ('publish', 'restore', 'legacy_put', 'make_general')`),
    check("agent_publish_log_snapshot_chk", sql`jsonb_typeof(${t.snapshot}) = 'object'`),
    foreignKey({
      name: "agent_publish_log_org_agent_fk",
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("cascade"),
  ]
);

/**
 * 031 (PR B) — Qué agente atiende cada etapa del pipeline. La llave primaria
 * `(organization_id, stage_id)` es la regla «un agente por etapa» (D6); un
 * agente puede tener varias. Solo opera con el módulo Laboratorio (D7) y solo
 * si el agente está publicado y no archivado (si no, atiende el general).
 * Única puerta: src/server/agents/assignments.ts.
 */
export const agentStageAssignment = pgTable(
  "agent_stage_assignment",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    stageId: text("stage_id").notNull(),
    agentId: text("agent_id").notNull(),
    assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "agent_stage_assignment_pk", columns: [t.organizationId, t.stageId] }),
    index("agent_stage_assignment_agent_idx").on(t.organizationId, t.agentId),
    foreignKey({
      name: "agent_stage_assignment_org_stage_fk",
      columns: [t.organizationId, t.stageId],
      foreignColumns: [pipelineStage.organizationId, pipelineStage.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "agent_stage_assignment_org_agent_fk",
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("cascade"),
  ]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    /** 031 — NULL = conocimiento compartido; si no, solo de ese agente. */
    agentId: text("agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("kb_org_idx").on(t.organizationId),
    index("kb_org_agent_idx").on(t.organizationId, t.agentId),
    foreignKey({
      name: "kb_entry_org_agent_fk",
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("cascade"),
  ]
);

/**
 * 024 — Conocimientos: material que el EQUIPO consulta y envía a los clientes
 * (fichas, catálogos, políticas, respuestas tipo). Distinto de `kb_entry`,
 * que es lo que lee el agente de IA en su prompt: el agente NO lee esta tabla.
 *
 * Una entrada lleva texto, un archivo o ambos. El archivo vive en el volumen
 * local `MEDIA_DIR` (constitución II: sin S3/R2) con la ruta `<org>/<id>`.
 */
export const knowledgeEntry = pgTable(
  "knowledge_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Contenido de texto (lo que se manda como mensaje). Vacío si solo es archivo. */
    body: text("body").notNull().default(""),
    /** Etiquetas libres para filtrar (no son las etiquetas de contacto de 021). */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Ruta relativa en MEDIA_DIR; NULL = entrada solo de texto. */
    filePath: text("file_path"),
    fileName: text("file_name"),
    fileMime: text("file_mime"),
    fileSize: integer("file_size"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("knowledge_entry_org_updated_idx").on(t.organizationId, t.updatedAt)]
);

/**
 * Campañas v2 (PR 1) — Un componente de plantilla como lo devuelve Meta.
 * Subconjunto tipado de lo que el CRM lee; el resto se conserva tal cual.
 */
export type TemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string; url?: string; phone_number?: string; example?: unknown }[];
  example?: unknown;
  [key: string]: unknown;
};

export const template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: text("wa_template_id"),
    /**
     * Campañas v2 (PR 1) — los componentes completos tal como los guarda
     * Meta (HEADER, BODY, FOOTER, BUTTONS). NULL en plantillas anteriores a
     * la 0031 hasta la siguiente sincronización; `body` sigue siendo el
     * texto del cuerpo para quien ya lo lee.
     */
    components: jsonb("components").$type<TemplateComponent[]>(),
    /**
     * Estado crudo de Meta (APPROVED, PAUSED, DISABLED, IN_APPEAL…). `status`
     * conserva sus cuatro valores; solo se envía con `status = approved` Y
     * `meta_status` APPROVED (o NULL, filas anteriores a la 0031).
     */
    metaStatus: text("meta_status"),
    /** Motivo de pausa o desactivación que manda Meta. */
    pausedReason: text("paused_reason"),
    /** Calificación de calidad de la plantilla (GREEN, YELLOW, RED, UNKNOWN o NA). */
    qualityScore: text("quality_score"),
    /** Meta cambió la categoría: la anterior, cuándo, y cuándo lo vio el equipo. */
    previousCategory: text("previous_category"),
    categoryChangedAt: timestamp("category_changed_at"),
    categoryChangeSeenAt: timestamp("category_change_seen_at"),
    /**
     * Meta AVISÓ que la categoría va a cambiar (webhook
     * `template_category_update` con `correct_category`): la que tendrá y
     * desde cuándo (`category_update_timestamp`). `category` sigue siendo la
     * actual hasta que llegue el cambio hecho.
     */
    upcomingCategory: text("upcoming_category"),
    upcomingCategoryAt: timestamp("upcoming_category_at"),
    /** Última vez que se leyó de Meta (sincronización o webhook). */
    syncedAt: timestamp("synced_at"),
    /**
     * La imagen del encabezado, guardada en el disco propio (MEDIA_DIR) al
     * crear la plantilla desde el CRM: al ENVIAR, Meta pide la imagen en
     * cada mensaje y esta es la que se manda.
     */
    headerMediaAssetId: text("header_media_asset_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("template_org_wa_template_idx").on(t.organizationId, t.waTemplateId),
    // Campañas v2 (PR 1). En la BD es ON DELETE SET NULL (header_media_asset_id) (0031)
    foreignKey({
      name: "template_org_header_media_fk",
      columns: [t.organizationId, t.headerMediaAssetId],
      foreignColumns: [mediaAsset.organizationId, mediaAsset.id],
    }).onDelete("set null"),
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    ),
    unique("template_org_id_uq").on(t.organizationId, t.id),
  ]
);

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    score: integer("score"),
    error: text("error"),
    /** 031 — Agente evaluado (NULL en corridas anteriores o si se borró). */
    agentId: text("agent_id"),
    /**
     * 031 — Lo que se evaluó, tal cual: `{ source, config, kbText }`. El
     * runner y el juez usan esto (no releen la BD a media corrida) y el
     * historial sigue siendo reproducible aunque el agente cambie.
     */
    agentSnapshot: jsonb("agent_snapshot"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq")
      .on(t.organizationId)
      .where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
    unique("agent_test_run_org_id_uq").on(t.organizationId, t.id),
    // 031. En la BD es ON DELETE SET NULL (agent_id) (0035).
    foreignKey({
      name: "agent_test_run_org_agent_fk",
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("set null"),
  ]
);

/* ============================================================
 * 015 — Motor de agenda (detrás de la bandera AGENDA)
 *
 * Las tablas se crean SIEMPRE, encendida o apagada la bandera: una tabla
 * vacía es inerte, y a cambio todas las instancias del mundo comparten la
 * misma estructura y la misma cadena de migraciones (ADR-001).
 * ============================================================ */

/** Configuración de la agenda del negocio: una fila por organización. */
export const calendarSettings = pgTable(
  "calendar_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** `{"mon":[{"start":"09:00","end":"18:00"}]}` — hora de PARED, no UTC. */
    weeklyHours: jsonb("weekly_hours").notNull(),
    slotMinutes: integer("slot_minutes").notNull().default(30),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    minNoticeHours: integer("min_notice_hours").notNull().default(2),
    maxDaysAhead: integer("max_days_ahead").notNull().default(7),
    timezone: text("timezone").notNull().default("America/Mexico_City"),
    /**
     * Cómo se entrega la reunión. `enlace-fijo` no habla con nadie: es el
     * default y la razón de que encender la agenda no exija terceros.
     * Un fork agrega el suyo al catálogo del código sin tocar esta columna.
     */
    connector: text("connector").notNull().default("enlace-fijo"),
    /** Sala fija del conector `enlace-fijo`; null ⇒ citas sin link. */
    meetingLink: text("meeting_link"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendar_settings_org_uq").on(t.organizationId)]
);

/**
 * La cita. Una sola tabla para sesiones y bloqueos manuales: un bloqueo es
 * una cita sin contacto que ocupa agenda igual.
 */
export const booking = pgTable(
  "booking",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["session", "block"] })
      .notNull()
      .default("session"),
    status: text("status", {
      enum: ["agendada", "realizada", "no_show", "cancelada"],
    })
      .notNull()
      .default("agendada"),
    source: text("source", { enum: ["manual", "ai"] })
      .notNull()
      .default("manual"),
    contactId: text("contact_id"),
    conversationId: text("conversation_id"),
    leadId: text("lead_id"),
    /** Instante UTC. El horario semanal es de pared; esto ya está resuelto. */
    scheduledAt: timestamp("scheduled_at").notNull(),
    /** Capturada al crear: cambiar la configuración no reescribe el pasado. */
    durationMinutes: integer("duration_minutes").notNull(),
    /**
     * Con qué conector nació la ENTREGA. Reprogramar y cancelar hablan con
     * ESTE, no con el activo: si el negocio cambia de proveedor, las citas ya
     * confirmadas siguen viviendo donde se crearon.
     */
    connector: text("connector"),
    /** Id de la reunión/evento en el proveedor; null en `enlace-fijo`. */
    externalRef: text("external_ref"),
    /**
     * El link que se le dio al cliente. Se COPIA, no se lee de la
     * configuración: la cita es un hecho histórico, no una vista del presente.
     */
    meetingLink: text("meeting_link"),
    /**
     * El proveedor falló al crear la reunión. La cita existe igual —un tercero
     * caído no cuesta la conversión— y el operador reintenta desde "Citas".
     */
    linkPending: boolean("link_pending").notNull().default(false),
    /** Conversación del Laboratorio: jamás llama a un conector real. */
    isTest: boolean("is_test").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("booking_org_when_idx").on(t.organizationId, t.scheduledAt),
    index("booking_org_status_idx").on(t.organizationId, t.status),
    /**
     * Anti doble-booking ATÓMICO. La re-validación al confirmar deja una
     * ventana entre leer y escribir; esto la cierra en la BASE: dos
     * confirmaciones simultáneas del mismo instante no pueden ganar las dos, y
     * la perdedora recibe un 23505 que el servicio traduce a `slot_taken` con
     * alternativas frescas. Las citas de prueba quedan fuera: no consumen la
     * agenda real.
     */
    uniqueIndex("booking_org_active_slot_uq")
      .on(t.organizationId, t.scheduledAt)
      .where(
        sql`${t.status} in ('agendada','realizada') and ${t.isTest} = false`
      ),
    // Fase 1 (H6): el contacto es de la MISMA organización
    foreignKey({
      name: "booking_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (conversation_id) (0024)
    foreignKey({
      name: "booking_org_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversation.organizationId, conversation.id],
    }).onDelete("set null"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (lead_id) (0024)
    foreignKey({
      name: "booking_org_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }).onDelete("set null"),
  ]
);

/**
 * La memoria de lo ofrecido. Es lo que hace verificable el requisito
 * innegociable: sin fila aquí, no hay reserva.
 *
 * Vive en el CRM y no en quien conduce la conversación porque Vocero promete
 * "conecta TU propio cerebro": con la garantía del lado del cliente, cualquier
 * cerebro podría reservar un instante que jamás se ofreció y el CRM lo
 * aceptaría.
 */
export const offeredSlot = pgTable(
  "offered_slot",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull(),
    startUtc: timestamp("start_utc").notNull(),
    /** La etiqueta EXACTA que se le mostró al cliente. */
    label: text("label").notNull(),
    offeredAt: timestamp("offered_at").notNull().defaultNow(),
  },
  (t) => [
    index("offered_slot_conv_idx").on(t.conversationId, t.startUtc),
    // Fase 1 (H20): los huecos ofrecidos de un chat, en orden
    // (agenda/offers.ts: scoped(org, conversation_id) order by start_utc).
    index("offered_slot_org_conv_idx").on(t.organizationId, t.conversationId, t.startUtc),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "offered_slot_org_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversation.organizationId, conversation.id],
    }).onDelete("cascade"),
  ]
);

/**
 * Credenciales del conector Zoom (app Server-to-Server del propio negocio).
 * Tabla explícita como las de WhatsApp e Instagram: unas credenciales tienen
 * forma fija y conocida, y así conservan tipado e índices. El secreto se cifra
 * con los mismos helpers; un segundo mecanismo sería otro que auditar.
 */
export const zoomCredentials = pgTable(
  "zoom_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    clientId: text("client_id").notNull(),
    secretCipher: text("secret_cipher").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretTag: text("secret_tag").notNull(),
    /**
     * PR 1 Fase 3 — con qué versión de ENCRYPTION_KEY está cifrado lo de esta
     * fila (`src/server/credentials/`). La rotación la sube al arrancar.
     */
    keyVersion: integer("key_version").notNull().default(1),
    /** `error` SE ESCRIBE cuando el proveedor rechaza la autenticación. */
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("zoom_credentials_org_uq").on(t.organizationId)]
);

/**
 * Credenciales del conector Google (Calendar + Meet), de la app de Google
 * Cloud del propio negocio. DOS secretos cifrados: el client secret y el
 * refresh token pegado una sola vez.
 */
export const googleCredentials = pgTable(
  "google_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    clientSecretCipher: text("client_secret_cipher").notNull(),
    clientSecretIv: text("client_secret_iv").notNull(),
    clientSecretTag: text("client_secret_tag").notNull(),
    refreshTokenCipher: text("refresh_token_cipher").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenTag: text("refresh_token_tag").notNull(),
    /**
     * PR 1 Fase 3 — con qué versión de ENCRYPTION_KEY está cifrado lo de esta
     * fila (`src/server/credentials/`). La rotación la sube al arrancar.
     */
    keyVersion: integer("key_version").notNull().default(1),
    calendarId: text("calendar_id").notNull().default("primary"),
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("google_credentials_org_uq").on(t.organizationId)]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull(),
    persona: text("persona").notNull(),
    conversationId: text("conversation_id"),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("test_case_run_idx").on(t.runId),
    // Fase 1 (H20): los casos de una corrida del Laboratorio
    // (lab/runs/[id]: scoped(org, run_id) order by created_at).
    index("test_case_org_run_idx").on(t.organizationId, t.runId),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "agent_test_case_org_run_fk",
      columns: [t.organizationId, t.runId],
      foreignColumns: [agentTestRun.organizationId, agentTestRun.id],
    }).onDelete("cascade"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (conversation_id) (0025)
    foreignKey({
      name: "agent_test_case_org_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversation.organizationId, conversation.id],
    }).onDelete("set null"),
  ]
);

/* ============================================================
 * 016 — Atribución de anuncios y Conversions API
 * (detrás de la bandera ATRIBUCION)
 * ============================================================ */

/**
 * De qué anuncio vino una conversación. El primer referral gana: el UNIQUE de
 * abajo es lo que vuelve idempotente la captura ante los reintentos de Meta,
 * en vez de un "consulta y luego inserta" que dos webhooks simultáneos
 * ganarían los dos.
 */
export const adAttribution = pgTable(
  "ad_attribution",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull(),
    conversationId: text("conversation_id")
      .notNull(),
    /**
     * El identificador del clic en el anuncio. Es la llave de TODO: sin él no
     * hay nada que reportarle a Meta. Nullable porque hay referrals sin clid,
     * y porque sin la bandera ATRIBUCION no se guarda (018): el origen del
     * anuncio se ve siempre, el identificador de clic solo si se atribuye.
     */
    ctwaClid: text("ctwa_clid"),
    sourceId: text("source_id"),
    sourceType: text("source_type"),
    sourceUrl: text("source_url"),
    headline: text("headline"),
    body: text("body"),
    mediaType: text("media_type"),
    /**
     * 018 — La imagen del creativo, copiada del CDN de Meta (su URL caduca en
     * días). Compartida por todas las conversaciones del mismo `source_id`: se
     * descarga una vez por anuncio. Borrar el adjunto deja la fila sin imagen,
     * no apuntando a nada.
     */
    imageAssetId: text("image_asset_id"),
    /**
     * El referral recortado a sus claves conocidas (018: con cotas de tamaño,
     * y sin `ctwa_clid` si la bandera estaba apagada). Es la póliza contra
     * "Meta agregó un campo", y de aquí se vuelve a leer la URL de la imagen
     * cuando hay que reparar la copia.
     */
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_attribution_org_conversation_uq").on(
      t.organizationId,
      t.conversationId
    ),
    index("ad_attribution_org_contact_idx").on(t.organizationId, t.contactId),
    // 018 — la imagen ya guardada de un anuncio, y a qué filas asignarla.
    index("ad_attribution_org_source_idx").on(t.organizationId, t.sourceId),
    // Fase 1 (H6): el contacto es de la MISMA organización
    foreignKey({
      name: "ad_attribution_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
    // Fase 1 (H6): la conversación es de la MISMA organización
    foreignKey({
      name: "ad_attribution_org_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversation.organizationId, conversation.id],
    }).onDelete("cascade"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (image_asset_id) (0024)
    foreignKey({
      name: "ad_attribution_org_image_asset_fk",
      columns: [t.organizationId, t.imageAssetId],
      foreignColumns: [mediaAsset.organizationId, mediaAsset.id],
    }).onDelete("set null"),
    unique("ad_attribution_org_id_uq").on(t.organizationId, t.id),
  ]
);

/**
 * Cada intento de reportarle un desenlace a Meta. Las filas `skipped` no son
 * basura: son la respuesta a "¿por qué este lead no aparece en Meta?", que sin
 * ellas se contesta adivinando.
 */
export const conversionEvent = pgTable(
  "conversion_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull(),
    attributionId: text("attribution_id"),
    /** Nombre del catálogo de Meta tal cual (`QualifiedLead`, `Purchase`). */
    eventName: text("event_name").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed", "skipped"] })
      .notNull()
      .default("pending"),
    /** Motivo legible: por qué se omitió, o qué contestó Meta. */
    error: text("error"),
    /**
     * Acuse del envío. Es la única referencia que Meta pide para rastrear un
     * evento de su lado; sin persistirla, un `sent` no se puede reclamar.
     */
    fbTraceId: text("fb_trace_id"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // El dedup ES este índice: la fila se inserta ANTES de hablar con Meta y
    // con ON CONFLICT DO NOTHING. Dos movimientos simultáneos del mismo lead
    // no pueden mandar dos compras.
    uniqueIndex("conversion_event_org_conv_name_uq").on(
      t.organizationId,
      t.conversationId,
      t.eventName
    ),
    index("conversion_event_org_created_idx").on(
      t.organizationId,
      t.createdAt
    ),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "conversion_event_org_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversation.organizationId, conversation.id],
    }).onDelete("cascade"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (attribution_id) (0025)
    foreignKey({
      name: "conversion_event_org_attribution_fk",
      columns: [t.organizationId, t.attributionId],
      foreignColumns: [adAttribution.organizationId, adAttribution.id],
    }).onDelete("set null"),
  ]
);

/** Conexión del negocio con su dataset de Meta (token cifrado en reposo). */
export const capiSettings = pgTable(
  "capi_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id").notNull(),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * PR 1 Fase 3 — con qué versión de ENCRYPTION_KEY está cifrado lo de esta
     * fila (`src/server/credentials/`). La rotación la sube al arrancar.
     */
    keyVersion: integer("key_version").notNull().default(1),
    /**
     * Qué etapa significa "lead calificado" PARA ESTE NEGOCIO. Las etapas
     * sembradas de Vocero no incluyen ninguna con ese nombre y cada quien
     * renombra las suyas, así que se elige en vez de adivinarse. NULL = ese
     * evento no se emite. `set null` a propósito: borrar la etapa apaga el
     * evento, no rompe la configuración.
     */
    qualifiedStageId: text("qualified_stage_id"),
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("capi_settings_org_uq").on(t.organizationId),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (qualified_stage_id) (0025)
    foreignKey({
      name: "capi_settings_org_qualified_stage_fk",
      columns: [t.organizationId, t.qualifiedStageId],
      foreignColumns: [pipelineStage.organizationId, pipelineStage.id],
    }).onDelete("set null"),
  ]
);

/* ============================================================
 * 021 — Campañas: envío masivo de una plantilla aprobada
 * ============================================================ */

/**
 * Una campaña = UNA plantilla aprobada enviada a un público (siempre
 * `opt_in`). `audience` y `variables` guardan lo que se eligió, para poder
 * reconstruir exactamente qué se mandó aunque después cambien las etiquetas.
 */
export const campaign = pgTable(
  "campaign",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // restrict: una plantilla con campañas no se borra en silencio y deja un
    // registro de auditoría que ya no dice qué se mandó.
    templateId: text("template_id")
      .notNull(),
    name: text("name").notNull(),
    /**
     * Valor de {{1}}, {{2}}…: un texto fijo para todos, o el nombre de cada
     * destinatario (ver `CampaignVariable` en lib/campaigns.ts).
     */
    variables: jsonb("variables")
      .$type<({ kind: "fixed"; value: string } | { kind: "contact_name" } | { kind: "column"; column: string })[]>()
      .notNull()
      .default([]),
    /** El filtro de público tal como se eligió (etiquetas, fuente). */
    audience: jsonb("audience").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * Campañas v2 (PR 2): `scheduled` (espera su hora), `paused` (a mano o
     * por la pausa de seguridad) y `cancelled`. Texto sin CHECK en la BD: el
     * código anterior solo reanuda `sending`, así que revertir deja quietas
     * las pausadas y programadas (sin envíos fantasma).
     */
    status: text("status", {
      enum: ["draft", "scheduled", "sending", "paused", "completed", "cancelled", "failed"],
    })
      .notNull()
      .default("draft"),
    total: integer("total").notNull().default(0),
    /** Por qué se detuvo, si `failed` (p. ej. token vencido). */
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    /** Campañas v2: hora de envío programada (UTC; se elige en la zona de la organización). */
    scheduledAt: timestamp("scheduled_at"),
    /** El número que envía (la cola es POR NÚMERO). Se fija al lanzar. */
    phoneNumberId: text("phone_number_id"),
    /** Por qué está en pausa (a mano o automática), en español. */
    pauseReason: text("pause_reason"),
    /** true = la pausó la pausa de seguridad, no una persona. */
    autoPaused: boolean("auto_paused").notNull().default(false),
    /** Pausa automática por uso del límite: cuándo se vuelve a intentar sola. */
    resumeAt: timestamp("resume_at"),
    /** Costo ESTIMADO al lanzar (destinatarios × tarifa de la categoría). NULL = sin tarifa capturada. */
    estimatedCost: numeric("estimated_cost", { precision: 14, scale: 4, mode: "number" }),
    costCurrency: text("cost_currency"),
    /** Excluidos al lanzar, por motivo: { noConsent, optOut, invalid, duplicate, archived }. */
    excluded: jsonb("excluded").$type<Record<string, number>>(),
    /** Última prueba enviada a un número propio (no cuenta en la campaña). */
    testSentAt: timestamp("test_sent_at"),
  },
  (t) => [
    index("campaign_org_created_idx").on(t.organizationId, t.createdAt),
    index("campaign_status_idx").on(t.status),
    unique("campaign_org_id_uq").on(t.organizationId, t.id),
    // Fase 1 (H6): la plantilla es de la MISMA organización
    foreignKey({
      name: "campaign_org_template_fk",
      columns: [t.organizationId, t.templateId],
      foreignColumns: [template.organizationId, template.id],
    }).onDelete("restrict"),
  ]
);

/**
 * El log de auditoría de la campaña: a quién, cuándo y con qué resultado.
 * El teléfono y el nombre se copian al crear la fila para que el registro
 * sobreviva al borrado del contacto.
 */
export const campaignRecipient = pgTable(
  "campaign_recipient",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull(),
    contactId: text("contact_id"),
    contactName: text("contact_name").notNull(),
    phone: text("phone"),
    /**
     * Campañas v2 (PR 2): `sending` = reclamado por un despachador (con
     * `claimed_at`/`claimed_by`); `skipped` = no se le envió por una regla
     * (se dio de baja, se archivó) — no cuenta como fallo del número.
     */
    status: text("status", { enum: ["pending", "sending", "sent", "failed", "skipped"] })
      .notNull()
      .default("pending"),
    /** `message.id` del CRM (no el wamid): enlaza con el chat. */
    messageId: text("message_id"),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Cuándo lo reclamó un despachador. Un reclamo vencido se recupera. */
    claimedAt: timestamp("claimed_at"),
    /** Qué proceso lo reclamó (id aleatorio por contenedor). */
    claimedBy: text("claimed_by"),
    /** Intentos ante errores transitorios (límite de ritmo, Meta caído). */
    attempts: integer("attempts").notNull().default(0),
    /** No antes de esta hora (espera creciente tras un error transitorio). */
    nextAttemptAt: timestamp("next_attempt_at"),
    /** Los valores de {{1}}…{{n}} ya resueltos para este destinatario. */
    variables: jsonb("variables").$type<string[]>(),
    /** Código de error de Meta del último intento, si lo hubo. */
    errorCode: integer("error_code"),
  },
  (t) => [
    // Idempotencia: reanudar tras un reinicio nunca manda dos veces a nadie.
    uniqueIndex("campaign_recipient_campaign_contact_uq").on(
      t.campaignId,
      t.contactId
    ),
    index("campaign_recipient_campaign_status_idx").on(t.campaignId, t.status),
    // Fase 1 (H20): avance de una campaña (conteo por estado) y los
    // pendientes que reanuda el ejecutor, dentro de su organización.
    index("campaign_recipient_org_campaign_status_idx").on(t.organizationId, t.campaignId, t.status),
    // Fase 1 (H6): la campaña es de la MISMA organización
    foreignKey({
      name: "campaign_recipient_org_campaign_fk",
      columns: [t.organizationId, t.campaignId],
      foreignColumns: [campaign.organizationId, campaign.id],
    }).onDelete("cascade"),
    index("campaign_recipient_org_message_idx").on(t.organizationId, t.messageId),
    // Campañas v2 (PR 1): el mensaje es de la MISMA organización. El estado
    // de entrega se deriva de él (no se duplica). En la BD es
    // ON DELETE SET NULL (message_id) (0031).
    foreignKey({
      name: "campaign_recipient_org_message_fk",
      columns: [t.organizationId, t.messageId],
      foreignColumns: [message.organizationId, message.id],
    }).onDelete("set null"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (contact_id) (0024)
    foreignKey({
      name: "campaign_recipient_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("set null"),
  ]
);

/**
 * 022 — Bitácora de actividad del contacto: lo que NO registran
 * `lead_stage_event` ni `contact_assignment_event`. Append-only, mismo
 * contrato que ellas. Con esas dos arma la línea de tiempo del chat
 * (`src/server/activity/timeline.ts`); la única puerta que escribe aquí es
 * `src/server/activity/log.ts`.
 */
export const contactActivityEvent = pgTable(
  "contact_activity_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull(),
    kind: text("kind", {
      enum: [
        "note_added",
        "ai_paused",
        "ai_resumed",
        "ai_handoff",
        "consent_changed",
        "tag_added",
        "tag_removed",
        // 031 (PR B): cambió el agente que atiende (detail: from/to + nombres)
        "agent_changed",
      ],
    }).notNull(),
    /** Quién; NULL = no fue una persona (agente, cerebro externo, sistema). */
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: ["usuario", "bot", "api", "sistema"] })
      .notNull()
      .default("usuario"),
    /** Lo propio de cada tipo: texto de la nota, motivo, etiqueta… */
    detail: jsonb("detail").$type<Record<string, string | null>>(),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("cace_contact_occurred_idx").on(t.contactId, t.occurredAt),
    index("cace_org_occurred_idx").on(t.organizationId, t.occurredAt),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "contact_activity_event_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
  ]
);

/**
 * 022 — Preferencias de interfaz POR USUARIO (siguen entre dispositivos, a
 * diferencia del tema, que es por dispositivo). NULL = el default del rol.
 */
export const userPreference = pgTable(
  "user_preference",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    navCollapsed: boolean("nav_collapsed"),
    /** 022 — "expanded" | "collapsed" | "hidden" (ver `NAV_MODES`). Aditiva:
     *  `nav_collapsed` se conserva y se escribe en paralelo. */
    navMode: text("nav_mode"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })]
);

/* ============================================================
 * 025 — Chat de equipo (comunicación INTERNA entre usuarios de la misma
 * organización; los clientes no participan y nada de esto sale a Meta).
 *
 * Tablas propias y no `sales_team`: un canal necesita membresía explícita y
 * muchos-a-muchos (una persona en varios canales), y `sales_team` es "un
 * miembro, un equipo" sin código ni interfaz.
 * ============================================================ */

/**
 * 025 — Un hilo del chat de equipo: directo 1 a 1, grupo (creado desde
 * Ajustes) o el canal de avisos (uno por organización, todos participan de
 * forma implícita: no lleva filas en `team_chat_member`).
 */
export const teamChatThread = pgTable(
  "team_chat_thread",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["direct", "group", "announcements"] }).notNull(),
    /** Nombre del grupo o del canal; NULL en los directos. */
    name: text("name"),
    /** Directos: los dos userId ordenados y unidos por "|" (un directo por par). */
    directKey: text("direct_key"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("team_chat_thread_org_last_idx").on(t.organizationId, t.lastMessageAt),
    uniqueIndex("team_chat_thread_direct_uq").on(t.organizationId, t.directKey),
    uniqueIndex("team_chat_thread_announcements_uq")
      .on(t.organizationId)
      .where(sql`${t.kind} = 'announcements'`),
    unique("team_chat_thread_org_id_uq").on(t.organizationId, t.id),
  ]
);

/** 025 — Quién participa en un directo o un grupo. */
export const teamChatMember = pgTable(
  "team_chat_member",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    addedByUserId: text("added_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.userId] }),
    index("team_chat_member_org_user_idx").on(t.organizationId, t.userId),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "team_chat_member_org_thread_fk",
      columns: [t.organizationId, t.threadId],
      foreignColumns: [teamChatThread.organizationId, teamChatThread.id],
    }).onDelete("cascade"),
  ]
);

/**
 * 025 — Un adjunto del chat de equipo, en `MEDIA_DIR/team-chat/` (sin S3).
 * Aparte de `media_asset` a propósito: su visibilidad es por membresía del
 * hilo, no por el chat de un cliente (`scopedMediaAssets`).
 */
export const teamChatAttachment = pgTable(
  "team_chat_attachment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull(),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    mimeType: text("mime_type").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    /** Ruta relativa dentro de MEDIA_DIR. */
    storagePath: text("storage_path").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("team_chat_attachment_thread_idx").on(t.threadId),
    // Fase 1 (H20): los adjuntos de un hilo del chat de equipo.
    index("team_chat_attachment_org_thread_idx").on(t.organizationId, t.threadId),
    unique("team_chat_attachment_org_id_uq").on(t.organizationId, t.id),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "team_chat_attachment_org_thread_fk",
      columns: [t.organizationId, t.threadId],
      foreignColumns: [teamChatThread.organizationId, teamChatThread.id],
    }).onDelete("cascade"),
  ]
);

/**
 * 025 — Un mensaje del chat de equipo. Borrado SUAVE (`deleted_at`): el hilo
 * conserva el hueco ("mensaje eliminado") y el texto se vacía.
 */
export const teamChatMessage = pgTable(
  "team_chat_message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull(),
    authorUserId: text("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull().default(""),
    attachmentId: text("attachment_id"),
    /** Menciones (PR 2: chats de cliente). Solo ids: el nombre se resuelve al leer. */
    mentions: jsonb("mentions").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("team_chat_message_thread_created_idx").on(t.threadId, t.createdAt),
    // Fase 1 (H20): paginar un hilo por fecha dentro de la organización
    // (team-chat/messages.ts: scoped(org, thread_id) order by created_at).
    index("team_chat_message_org_thread_created_idx").on(t.organizationId, t.threadId, t.createdAt),
    unique("team_chat_message_org_id_uq").on(t.organizationId, t.id),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "team_chat_message_org_thread_fk",
      columns: [t.organizationId, t.threadId],
      foreignColumns: [teamChatThread.organizationId, teamChatThread.id],
    }).onDelete("cascade"),
    // Fase 1 (H6). En la BD es ON DELETE SET NULL (attachment_id) (0025)
    foreignKey({
      name: "team_chat_message_org_attachment_fk",
      columns: [t.organizationId, t.attachmentId],
      foreignColumns: [teamChatAttachment.organizationId, teamChatAttachment.id],
    }).onDelete("set null"),
  ]
);

/** 025 — Reacciones con emoji: una fila por (mensaje, persona, emoji). */
export const teamChatReaction = pgTable(
  "team_chat_reaction",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    // Fase 1 (H20): las reacciones de los mensajes de una página
    // (scoped(org, message_id in …)).
    index("team_chat_reaction_org_message_idx").on(t.organizationId, t.messageId),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "team_chat_reaction_org_message_fk",
      columns: [t.organizationId, t.messageId],
      foreignColumns: [teamChatMessage.organizationId, teamChatMessage.id],
    }).onDelete("cascade"),
  ]
);

/**
 * 025 — Hasta dónde leyó cada persona cada hilo: los "no leídos" son los
 * mensajes de OTROS posteriores a `last_read_at`. Sin fila = nada leído.
 */
export const teamChatReadState = pgTable(
  "team_chat_read_state",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.userId] }),
    index("team_chat_read_state_org_user_idx").on(t.organizationId, t.userId),
    // Fase 1 (H6): de la MISMA organización
    foreignKey({
      name: "team_chat_read_state_org_thread_fk",
      columns: [t.organizationId, t.threadId],
      foreignColumns: [teamChatThread.organizationId, teamChatThread.id],
    }).onDelete("cascade"),
  ]
);

/**
 * 025 — Ajustes del chat de equipo por organización. Sin fila = los defaults
 * (supervisión del Propietario ENCENDIDA, aviso apagado, grupos solo el
 * Propietario).
 */
export const teamChatSettings = pgTable("team_chat_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** El Propietario ve directos y grupos ajenos (solo lectura). */
  ownerOversight: boolean("owner_oversight").notNull().default(true),
  /** Los demás ven "El Propietario puede supervisar…" (solo si la supervisión está activa). */
  showOversightNotice: boolean("show_oversight_notice").notNull().default(false),
  /** Delegación de `team_chat.create_groups` al Coordinador (ver permissions.ts). */
  coordinatorsCanCreateGroups: boolean("coordinators_can_create_groups").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Fase 1 multitenant (H2) — Llaves del cerebro externo (`/api/bot/*`), UNA
 * organización por llave: la llave dice sobre qué negocio opera el cerebro.
 *
 * Solo se guarda el SHA-256 de la llave (32 bytes aleatorios: no hace falta
 * un hash lento) y un prefijo para reconocerla. Sin fila activa, la
 * superficie responde 401 para esa organización. Las crea el operador de la
 * plataforma (`scripts/bot-key.mjs`), no una pantalla: hoy el cerebro
 * externo es solo de la organización de la plataforma.
 *
 * `source = 'env'` es la `BOT_API_KEY` de la variable de entorno, que el
 * arranque liga a `PLATFORM_ORG_ID` (y revoca si la variable cambia).
 */
export const botApiKey = pgTable(
  "bot_api_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Los primeros caracteres de la llave, para reconocerla en un listado. */
    keyPrefix: text("key_prefix").notNull(),
    /** SHA-256 (hex) de la llave completa. */
    keyHash: text("key_hash").notNull(),
    source: text("source", { enum: ["script", "env"] }).notNull().default("script"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    uniqueIndex("bot_api_key_hash_uq").on(t.keyHash),
    index("bot_api_key_org_idx").on(t.organizationId),
  ]
);

/**
 * PR 1 Fase 3 — Eventos de webhook FIRMADOS por Meta que no se pudieron
 * enrutar: número, WABA o página que ninguna organización tiene conectada.
 * Antes se descartaban; ahora se guardan 7 días para diagnóstico.
 *
 * Tabla de PLATAFORMA (sin organización: justo no se sabe cuál es). La
 * escribe y la limpia solo el pool de sistema (`src/server/webhooks/unrouted.ts`).
 * El evento puede traer mensajes de clientes: va CIFRADO, nunca al log, y no
 * hay pantalla que lo muestre. Sin reprocesamiento automático.
 */
export const webhookUnrouted = pgTable(
  "webhook_unrouted",
  {
    id: text("id").primaryKey(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    /** whatsapp | instagram | messenger */
    source: text("source").notNull(),
    /** Qué se buscó y no apareció: phone_number_id, waba_id, page_id… */
    routeKind: text("route_kind").notNull(),
    routeKey: text("route_key").notNull(),
    /** Campo del webhook (messages, message_template_status_update…). */
    field: text("field"),
    /** Por qué no se enrutó (`unknown_route`; en el PR 2, `org_suspended`). */
    reason: text("reason").notNull().default("unknown_route"),
    /** SHA-256 del contenido: el mismo evento reintentado por Meta no se duplica. */
    payloadHash: text("payload_hash").notNull(),
    payloadCipher: text("payload_cipher").notNull(),
    payloadIv: text("payload_iv").notNull(),
    payloadTag: text("payload_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("webhook_unrouted_hash_uq").on(t.payloadHash),
    index("webhook_unrouted_received_idx").on(t.receivedAt),
    index("webhook_unrouted_route_idx").on(t.routeKind, t.routeKey),
  ]
);

/**
 * PR 1 Fase 3 — Tope mensual de IA de UNA organización (la llave de
 * OpenRouter es de la plataforma y la comparten todas). Sin fila, o con
 * NULL, vale el default del entorno (`AI_DEFAULT_MONTHLY_TURNS` /
 * `AI_DEFAULT_MONTHLY_TOKENS`); sin default, no hay tope.
 */
export const aiQuota = pgTable("ai_quota", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  monthlyTurnLimit: integer("monthly_turn_limit"),
  monthlyTokenLimit: integer("monthly_token_limit"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Fase 3, PR 3 — Qué módulos opcionales tiene ESTA organización (antes, las
 * banderas de despliegue CAMPAIGNS, AGENDA, ATRIBUCION y CHANNELS para toda la
 * instancia). Una fila por organización; la escribe solo el administrador de
 * plataforma (`src/server/modules/`). Sin fila, valen las variables de
 * entorno, que ahora son solo el valor por defecto para organizaciones nuevas.
 *
 * `channels`: los canales OPCIONALES encendidos (instagram, messenger).
 * WhatsApp no se apaga: es el canal por el que existe el producto.
 * `campaign_send_rate`: mensajes por segundo de las campañas; nulo = el de
 * `CAMPAIGN_SEND_RATE` (o 10).
 */
export const organizationModule = pgTable(
  "organization_module",
  {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  campaigns: boolean("campaigns").notNull().default(false),
  agenda: boolean("agenda").notNull().default(false),
  atribucion: boolean("atribucion").notNull().default(false),
  channels: text("channels").array().notNull().default(sql`'{}'::text[]`),
  campaignSendRate: integer("campaign_send_rate"),
  /**
   * 030 (PR 4) — Módulos que antes eran de todas las organizaciones. Nacen
   * ENCENDIDOS (DEFAULT true): migrar no le quita nada a nadie. `lab`
   * requiere `agent` (src/lib/modules/registry.ts).
   */
  knowledge: boolean("knowledge").notNull().default(true),
  lab: boolean("lab").notNull().default(true),
  agent: boolean("agent").notNull().default(true),
  teamChat: boolean("team_chat").notNull().default(true),
  results: boolean("results").notNull().default(true),
  /** 030 (PR 4) — ¿Puede el Propietario personalizar el menú por rol? Apagado por defecto. */
  customNav: boolean("custom_nav").notNull().default(false),
  /**
   * 033 — Tareas y Notas (dentro de «Trabajo», junto a Citas). Nace APAGADO
   * (DEFAULT false): a las organizaciones que ya existen no les aparece nada
   * nuevo. Los perfiles de alta Básico y Completo lo encienden.
   */
  trabajo: boolean("trabajo").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
},
  (t) => [
    check(
      "organization_module_send_rate_chk",
      sql`${t.campaignSendRate} is null or ${t.campaignSendRate} between 1 and 80`
    ),
    check("organization_module_channels_chk", sql`${t.channels} <@ array['instagram', 'messenger']::text[]`),
    // 030 (PR 4): el Laboratorio evalúa al agente; sin agente no existe.
    check("organization_module_lab_requires_agent_chk", sql`not ${t.lab} or ${t.agent}`),
  ]
);

/**
 * 030 (PR 4) — Menú lateral de un ROL en una organización (Ajustes →
 * Navegación). `items`: `[{ key, hidden }]` en orden (claves del registro de
 * módulos). Solo estético: el permiso y el módulo se validan en el servidor
 * aunque la entrada se vea. Sin fila, el menú de fábrica. Solo se aplica si la
 * plataforma encendió `organization_module.custom_nav`.
 */
export const navLayout = pgTable(
  "nav_layout",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    items: jsonb("items").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.role] }),
    check("nav_layout_role_chk", sql`${t.role} in ('owner', 'coordinador', 'asesor')`),
    check("nav_layout_items_chk", sql`jsonb_typeof(${t.items}) = 'array'`),
  ]
);

/**
 * 030 (PR 4) — Bitácora de Ajustes → Navegación: quién cambió el menú de qué
 * rol, con el antes y el después. Append-only (un disparador rechaza UPDATE).
 */
export const navLayoutEvent = pgTable(
  "nav_layout_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    action: text("action", { enum: ["saved", "reset"] }).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    /** NULL = era el de fábrica. */
    before: jsonb("before"),
    /** NULL = volvió al de fábrica. */
    after: jsonb("after"),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => [
    index("nav_layout_event_org_at_idx").on(t.organizationId, t.at),
    check("nav_layout_event_role_chk", sql`${t.role} in ('owner', 'coordinador', 'asesor')`),
    check("nav_layout_event_action_chk", sql`${t.action} in ('saved', 'reset')`),
  ]
);

/**
 * PR 1 Fase 3 — Consumo de IA por organización, mes (UTC) y tipo. Un turno
 * es una llamada a `chatJson` (con sus reintentos internos). Se reserva el
 * turno ANTES de llamar al modelo (atómico contra el tope) y se suman los
 * tokens que el proveedor reporta al terminar.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Primer día del mes en UTC, 'YYYY-MM-01'. */
    period: text("period").notNull(),
    /** agent | lab | judge | writing */
    kind: text("kind").notNull(),
    turns: integer("turns").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.period, t.kind] })]
);

/**
 * Fase 3, PR 2 — Administradores de PLATAFORMA (no son un rol de
 * organización: ser Propietario de un negocio no da nada aquí). El primero lo
 * crea el operador con `scripts/platform-admin.mjs`; nunca desde la interfaz.
 * Tabla de plataforma: solo el pool de sistema (`vocero_app` sin permisos).
 *
 * `failed_reauth` / `locked_until`: confirmar su propia contraseña antes de
 * generar un enlace de restablecimiento; 3 fallos → bloqueo temporal. En la
 * BD (no en memoria): reiniciar el servidor no lo borra.
 */
export const platformAdmin = pgTable("platform_admin", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /** null = lo creó el script del operador. */
  createdBy: text("created_by"),
  failedReauth: integer("failed_reauth").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
});

/**
 * Fase 3, PR 2 — Bitácora de lo que hace un administrador de plataforma
 * sobre una organización o un usuario. Sin FK a propósito: sobrevive al
 * borrado definitivo de la organización (por eso copia nombre y correo).
 * Nunca guarda secretos ni enlaces.
 */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: text("id").primaryKey(),
    at: timestamp("at").notNull().defaultNow(),
    actorUserId: text("actor_user_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetOrgId: text("target_org_id"),
    targetOrgName: text("target_org_name"),
    targetUserId: text("target_user_id"),
    targetUserEmail: text("target_user_email"),
    detail: jsonb("detail"),
    ip: text("ip"),
  },
  (t) => [
    index("platform_audit_log_at_idx").on(t.at),
    index("platform_audit_log_org_idx").on(t.targetOrgId, t.at),
  ]
);

/**
 * Fase 3, PR 2 — Enlaces de un solo uso para que una persona ponga SU
 * contraseña: activación del primer Propietario de una organización nueva y
 * restablecimiento que genera el administrador de plataforma. Solo se guarda
 * el SHA-256 del token; el enlace se muestra una vez. Tabla de plataforma
 * (la persona aún no tiene sesión): solo el pool de sistema.
 */
export const accountLinkToken = pgTable(
  "account_link_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["activate", "reset"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    usedIp: text("used_ip"),
    usedUserAgent: text("used_user_agent"),
    /** El administrador que lo generó (null = el alta de la organización). */
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("account_link_token_hash_uq").on(t.tokenHash),
    index("account_link_token_user_idx").on(t.userId),
  ]
);

/**
 * Campañas v2 (PR 1) — Historial DIARIO de la salud de cada número de
 * WhatsApp: calidad, límite de mensajería, estado y rendimiento, tal como
 * los reporta Meta. Una fila por (organización, número, día), con upsert: la
 * sincronización diaria, el botón "Actualizar" y los webhooks
 * `phone_number_quality_update` / `account_update` escriben la fila del día.
 * Lleva `phone_number_id` desde ya: el esquema admite varios números aunque
 * hoy haya uno por organización. Sin FK a `meta_credentials` a propósito: el
 * historial sobrevive a una reconexión.
 */
export const waPhoneHealth = pgTable(
  "wa_phone_health",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id").notNull(),
    /** Día en UTC al que corresponde la lectura. */
    day: date("day", { mode: "string" }).notNull(),
    /** GREEN, YELLOW, RED, UNKNOWN o NA (crudo de Meta). */
    qualityRating: text("quality_rating"),
    /** Límite crudo de Meta (TIER_250, TIER_1K… o UNLIMITED). */
    messagingLimit: text("messaging_limit"),
    /** El mismo límite como número de destinatarios; NULL = ilimitado o desconocido. */
    messagingLimitValue: integer("messaging_limit_value"),
    /** Estado del número (CONNECTED, FLAGGED, RESTRICTED…). */
    status: text("status"),
    /** Nivel de rendimiento (STANDARD, HIGH…). */
    throughputLevel: text("throughput_level"),
    /** Estado del nombre para mostrar (APPROVED, PENDING_REVIEW…). */
    nameStatus: text("name_status"),
    /** Último evento `account_update` de la WABA (violación o restricción), crudo. */
    accountEvent: jsonb("account_event").$type<Record<string, unknown>>(),
    source: text("source", { enum: ["sync", "manual", "webhook"] }).notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wa_phone_health_org_phone_day_uq").on(t.organizationId, t.phoneNumberId, t.day),
    check("wa_phone_health_source_chk", sql`${t.source} in ('sync', 'manual', 'webhook')`),
  ]
);

/**
 * Campañas v2 (PR 1) — Ajustes de mensajería por organización. Sin fila =
 * los valores por defecto del código (`src/server/messaging-settings.ts`).
 *
 * - Palabras de baja (STOP/BAJA): un entrante que coincide COMPLETO con una
 *   de ellas pasa al contacto a `opt_out`.
 * - Respuesta automática a la baja: apagada por defecto.
 * - Umbral de la alerta de uso del límite de mensajería (porcentaje).
 */
export const messagingSettings = pgTable(
  "messaging_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    stopKeywordsEnabled: boolean("stop_keywords_enabled").notNull().default(true),
    stopKeywords: text("stop_keywords").array().notNull(),
    stopReplyEnabled: boolean("stop_reply_enabled").notNull().default(false),
    stopReplyText: text("stop_reply_text"),
    usageAlertPercent: integer("usage_alert_percent").notNull().default(80),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "messaging_settings_usage_alert_chk",
      sql`${t.usageAlertPercent} between 1 and 100`
    ),
  ]
);

/* ============================================================
 * Campañas v2 (PR 2) — Audiencias, ajustes de envío y cola por número
 * ============================================================ */

/**
 * Una base de contactos subida (.xlsx o .csv) desde Campañas → Audiencias.
 * Es la "base guardada" que el asistente ofrece como público: sus miembros
 * están en `audience_member`, y además todos quedan con la etiqueta de la
 * importación (`tag_id`) para filtrarlos en Contactos.
 *
 * `failures` guarda hasta 5 000 filas rechazadas para descargarlas después;
 * `consent_source` es lo que la persona DECLARÓ sobre cómo obtuvo el
 * consentimiento (queda también en cada contacto).
 */
export const audienceImport = pgTable(
  "audience_import",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fileName: text("file_name").notNull(),
    fileKind: text("file_kind", { enum: ["csv", "xlsx"] }).notNull(),
    tagId: text("tag_id"),
    consentSource: text("consent_source").notNull(),
    /** Columnas extra del archivo (no nombre/número/correo/etiquetas): sirven como variables. */
    columns: jsonb("columns").$type<string[]>().notNull().default([]),
    /** { totalRows, created, updated, invalid, duplicate, empty, members }. */
    counts: jsonb("counts").$type<Record<string, number>>().notNull(),
    /** Filas rechazadas: { line, name, phone, reason }[] (máx. 5 000). */
    failures: jsonb("failures")
      .$type<{ line: number; name: string; phone: string; reason: string }[]>()
      .notNull()
      .default([]),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("audience_import_org_id_uq").on(t.organizationId, t.id),
    index("audience_import_org_created_idx").on(t.organizationId, t.createdAt),
    check("audience_import_file_kind_chk", sql`${t.fileKind} in ('csv', 'xlsx')`),
    // En la BD es ON DELETE SET NULL (tag_id) (0032): borrar la etiqueta no
    // borra la base.
    foreignKey({
      name: "audience_import_org_tag_fk",
      columns: [t.organizationId, t.tagId],
      foreignColumns: [contactTag.organizationId, contactTag.id],
    }).onDelete("set null"),
  ]
);

/**
 * Quién está en cada base, con los valores de sus columnas extra (`fields`),
 * que el asistente usa para llenar variables ("{{2}}" = columna "cupón").
 */
export const audienceMember = pgTable(
  "audience_member",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    importId: text("import_id").notNull(),
    contactId: text("contact_id").notNull(),
    fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ name: "audience_member_pk", columns: [t.organizationId, t.importId, t.contactId] }),
    index("audience_member_org_contact_idx").on(t.organizationId, t.contactId),
    foreignKey({
      name: "audience_member_org_import_fk",
      columns: [t.organizationId, t.importId],
      foreignColumns: [audienceImport.organizationId, audienceImport.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "audience_member_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
  ]
);

/**
 * Ajustes de envío de campañas por organización. Sin fila = los valores por
 * defecto del código (`src/server/campaigns/settings.ts`).
 *
 * - Pausa de seguridad: tasa de fallos (%) sobre los últimos N intentos (con
 *   mínimo N), calidad ROJA del número y uso del límite diario (%).
 * - Tarifas ESTIMADAS por categoría de plantilla y su moneda: las captura el
 *   negocio; Vocero no trae precios de Meta.
 * - Ventana de respuestas (horas) para Métricas (PR 3).
 */
export const campaignSettings = pgTable(
  "campaign_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    failRatePercent: integer("fail_rate_percent").notNull().default(20),
    failRateWindow: integer("fail_rate_window").notNull().default(50),
    pauseOnQualityRed: boolean("pause_on_quality_red").notNull().default(true),
    usagePausePercent: integer("usage_pause_percent").notNull().default(95),
    /** { marketing?, utility?, authentication? }: costo estimado por mensaje. */
    rates: jsonb("rates").$type<Record<string, number>>().notNull().default({}),
    currency: text("currency"),
    replyWindowHours: integer("reply_window_hours").notNull().default(72),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("campaign_settings_fail_rate_chk", sql`${t.failRatePercent} between 1 and 100`),
    check("campaign_settings_fail_window_chk", sql`${t.failRateWindow} between 10 and 1000`),
    check("campaign_settings_usage_pause_chk", sql`${t.usagePausePercent} between 1 and 100`),
    check("campaign_settings_reply_window_chk", sql`${t.replyWindowHours} between 1 and 720`),
  ]
);

/**
 * Quién despacha los envíos de un número. Varias réplicas del contenedor
 * pueden correr a la vez: solo la dueña de la concesión (renovada cada pocos
 * segundos) envía por ese número, así el ritmo es POR NÚMERO y no se suma
 * entre réplicas. Una concesión sin renovar vence y la toma otra.
 */
export const waSendLease = pgTable(
  "wa_send_lease",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id").notNull(),
    owner: text("owner").notNull(),
    heartbeatAt: timestamp("heartbeat_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "wa_send_lease_pk", columns: [t.organizationId, t.phoneNumberId] })]
);

/* ============================================================
 * Campañas v2 (PR 3) — Analíticas de Meta copiadas a la base propia
 * ============================================================ */

/**
 * Lo que Meta reporta de cada plantilla por día (`template_analytics` de la
 * WABA): enviados, entregados, leídos y clics de botón. Meta lo guarda 90
 * días; aquí se conserva. Lo escribe SOLO la sincronización diaria
 * (`src/server/meta-sync/analytics.ts`, upsert por llave): ninguna pantalla
 * consulta a Meta en vivo. Sin FK a `template` a propósito: Meta reporta
 * plantillas que el CRM pudo haber borrado; el nombre se busca al leer.
 */
export const waTemplateAnalyticsDaily = pgTable(
  "wa_template_analytics_daily",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    /** El id de la plantilla en Meta (`template.wa_template_id`). */
    waTemplateId: text("wa_template_id").notNull(),
    /** Día (UTC, como lo corta Meta). */
    day: date("day", { mode: "string" }).notNull(),
    sent: integer("sent").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    read: integer("read").notNull().default(0),
    /** Suma de los clics de todos los botones. */
    clicked: integer("clicked").notNull().default(0),
    /** Detalle crudo de clics: { type, button_content, count }[]. */
    clicks: jsonb("clicks").$type<{ type?: string; button_content?: string; count?: number }[]>().notNull().default([]),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "wa_template_analytics_daily_pk", columns: [t.organizationId, t.wabaId, t.waTemplateId, t.day] }),
    index("wa_template_analytics_daily_org_day_idx").on(t.organizationId, t.day),
  ]
);

/**
 * Volumen y costo que Meta reporta por día (`pricing_analytics` de la WABA),
 * por número, país, categoría y tipo de cobro. Meta lo guarda 1 año. Es lo
 * "Reportado por Meta" frente al costo "Estimado" de las campañas. Las
 * dimensiones que Meta no mande quedan en '' (forman parte de la llave).
 */
export const waPricingAnalyticsDaily = pgTable(
  "wa_pricing_analytics_daily",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    phoneNumberId: text("phone_number_id").notNull().default(""),
    country: text("country").notNull().default(""),
    /** MARKETING, UTILITY, AUTHENTICATION, SERVICE… (crudo de Meta). */
    pricingCategory: text("pricing_category").notNull().default(""),
    /** REGULAR, FREE_CUSTOMER_SERVICE, FREE_ENTRY_POINT… (crudo de Meta). */
    pricingType: text("pricing_type").notNull().default(""),
    volume: integer("volume").notNull().default(0),
    cost: numeric("cost", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
    /** Moneda de la WABA según Meta; NULL si no la reportó. */
    currency: text("currency"),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "wa_pricing_analytics_daily_pk",
      columns: [t.organizationId, t.wabaId, t.day, t.phoneNumberId, t.country, t.pricingCategory, t.pricingType],
    }),
    index("wa_pricing_analytics_daily_org_day_idx").on(t.organizationId, t.day),
  ]
);

/**
 * Estado de la última sincronización de cada analítica (plantillas, precios)
 * por WABA: decide la primera carga (90 días / 1 año) frente a la diaria, y
 * deja dicho en la pantalla si Meta respondió que las analíticas de
 * plantillas no están activas (`not_enabled`).
 */
export const waAnalyticsSync = pgTable(
  "wa_analytics_sync",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    kind: text("kind", { enum: ["template", "pricing"] }).notNull(),
    status: text("status", { enum: ["ok", "not_enabled", "error"] }).notNull(),
    /** Mensaje de Meta del último fallo (sin secretos), si lo hubo. */
    error: text("error"),
    /** Último intento (éxito o fallo). */
    attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
    /** Última sincronización completa; NULL = nunca (toca la carga inicial). */
    syncedAt: timestamp("synced_at"),
  },
  (t) => [
    primaryKey({ name: "wa_analytics_sync_pk", columns: [t.organizationId, t.wabaId, t.kind] }),
    check("wa_analytics_sync_kind_chk", sql`${t.kind} in ('template', 'pricing')`),
    check("wa_analytics_sync_status_chk", sql`${t.status} in ('ok', 'not_enabled', 'error')`),
  ]
);

/**
 * 033 — Tareas del equipo (módulo «Trabajo», clave `trabajo`). Lista simple
 * tipo recordatorios: título, descripción y fecha límite opcionales,
 * responsable (una persona del negocio) y hecha/pendiente. Puede ligarse a un
 * contacto o a una conversación; borrar ese contacto o chat deja la tarea sin
 * ligadura (SET NULL solo de esa columna), no la borra.
 *
 * La ÚNICA puerta que la lee y escribe es `src/server/work/tasks.ts`. Nunca
 * sale nada a Meta: es trabajo interno.
 */
export const workTask = pgTable(
  "work_task",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: timestamp("due_at"),
    /** Responsable. Que sea del negocio lo valida el código (como la asignación). */
    assigneeUserId: text("assignee_user_id").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    contactId: text("contact_id"),
    conversationId: text("conversation_id"),
    /** NULL = pendiente. */
    doneAt: timestamp("done_at"),
    doneBy: text("done_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("work_task_org_id_uq").on(t.organizationId, t.id),
    check("work_task_title_chk", sql`char_length(${t.title}) between 1 and 200`),
    index("work_task_org_assignee_idx").on(t.organizationId, t.assigneeUserId, t.doneAt),
    index("work_task_org_contact_idx").on(t.organizationId, t.contactId),
    // En la BD es ON DELETE SET NULL (contact_id) (0037).
    foreignKey({
      name: "work_task_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("set null"),
    // En la BD es ON DELETE SET NULL (conversation_id) (0037).
    foreignKey({
      name: "work_task_org_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversation.organizationId, conversation.id],
    }).onDelete("set null"),
  ]
);

/**
 * 033 (PR 2) — Notas del equipo, tipo Keep (módulo «Trabajo», clave
 * `trabajo`). Título opcional, texto, color de una lista cerrada, fijar
 * arriba y archivar. Internas: NUNCA se envían al cliente.
 *
 * Quién la ve: sin ligar (`contact_id` NULL), solo quien la escribió; ligada
 * a un contacto/chat, todo el que puede ver ese contacto (020). Borrar el
 * contacto o el chat deja la nota sin ligadura (SET NULL solo de esa columna):
 * vuelve a ser solo de quien la escribió.
 *
 * La ÚNICA puerta que la lee y escribe es `src/server/work/notes.ts`.
 */
export const workNote = pgTable(
  "work_note",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title"),
    body: text("body").notNull().default(""),
    color: text("color").notNull().default("ninguno"),
    pinnedAt: timestamp("pinned_at"),
    archivedAt: timestamp("archived_at"),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    contactId: text("contact_id"),
    conversationId: text("conversation_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("work_note_org_id_uq").on(t.organizationId, t.id),
    check("work_note_color_chk", sql`${t.color} in ('ninguno', 'amarillo', 'verde', 'azul', 'rosa', 'morado')`),
    check("work_note_title_chk", sql`${t.title} is null or char_length(${t.title}) <= 200`),
    check("work_note_body_chk", sql`char_length(${t.body}) <= 10000`),
    check("work_note_not_empty_chk", sql`char_length(${t.body}) > 0 or char_length(coalesce(${t.title}, '')) > 0`),
    index("work_note_org_author_idx").on(t.organizationId, t.authorUserId, t.archivedAt),
    index("work_note_org_contact_idx").on(t.organizationId, t.contactId),
    // En la BD es ON DELETE SET NULL (contact_id) (0038).
    foreignKey({
      name: "work_note_org_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("set null"),
    // En la BD es ON DELETE SET NULL (conversation_id) (0038).
    foreignKey({
      name: "work_note_org_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversation.organizationId, conversation.id],
    }).onDelete("set null"),
  ]
);

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { LinkSettings } from "@/lib/access/settings";

// Every table carries id, created_at, updated_at (BRD §8).
const base = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const roleEnum = pgEnum("role", ["owner", "admin", "editor", "viewer"]);
export const userStatusEnum = pgEnum("user_status", ["active", "invited", "disabled"]);
export const visitorStatusEnum = pgEnum("visitor_status", ["active", "suspended", "revoked"]);
export const linkStatusEnum = pgEnum("link_status", ["active", "disabled"]);
export const requestTypeEnum = pgEnum("request_type", ["access", "download"]);
export const requestStatusEnum = pgEnum("request_status", ["pending", "approved", "rejected"]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "visitor", "system"]);

// ---------------------------------------------------------------- team

export const users = pgTable("users", {
  ...base,
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: roleEnum("role").notNull().default("viewer"),
  twoFactorSecret: text("two_factor_secret"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  status: userStatusEnum("status").notNull().default("invited"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    ...base,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    // false until the second factor has been checked
    twoFactorPassed: boolean("two_factor_passed").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invites = pgTable("invites", {
  ...base,
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

// ---------------------------------------------------------------- documents

export const folders = pgTable(
  "folders",
  {
    ...base,
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, {
      onDelete: "cascade",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("folders_parent_idx").on(t.parentId)],
);

export const documents = pgTable(
  "documents",
  {
    ...base,
    name: text("name").notNull(),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "cascade" }),
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => documentVersions.id,
      { onDelete: "set null" },
    ),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("documents_folder_idx").on(t.folderId)],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    ...base,
    documentId: uuid("document_id")
      .notNull()
      .references((): AnyPgColumn => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(), // mime type
    size: bigint("size", { mode: "number" }).notNull(),
    pageCount: integer("page_count"),
    extractedText: text("extracted_text"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("document_versions_doc_ver_idx").on(t.documentId, t.versionNumber)],
);

// ---------------------------------------------------------------- agreements (NDA)

export const agreements = pgTable("agreements", {
  ...base,
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  storageKey: text("storage_key").notNull(),
  // superseded versions are kept so old signatures still point at what was signed
  isCurrent: boolean("is_current").notNull().default(true),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
});

// ---------------------------------------------------------------- links

export const links = pgTable(
  "links",
  {
    ...base,
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // Data rooms arrive in Phase 2; the column exists so links can attach later.
    dataRoomId: uuid("data_room_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: linkStatusEnum("status").notNull().default("active"),
    settings: jsonb("settings").$type<LinkSettings>().notNull(),
    passwordHash: text("password_hash"),
    // bumped whenever the password changes so existing visitor cookies stop passing the gate
    passwordVersion: integer("password_version").notNull().default(0),
    agreementId: uuid("agreement_id").references(() => agreements.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("links_created_by_idx").on(t.createdBy)],
);

export const linkScope = pgTable(
  "link_scope",
  {
    ...base,
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id"),
  },
  (t) => [index("link_scope_link_idx").on(t.linkId)],
);

export const allowedEmails = pgTable(
  "allowed_emails",
  {
    ...base,
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    emailOrDomain: text("email_or_domain").notNull(),
  },
  (t) => [uniqueIndex("allowed_emails_link_value_idx").on(t.linkId, t.emailOrDomain)],
);

// ---------------------------------------------------------------- visitors & analytics

export const visitors = pgTable("visitors", {
  ...base,
  email: text("email").notNull().unique(),
  name: text("name"),
  company: text("company"),
  status: visitorStatusEnum("status").notNull().default("active"),
  contactId: uuid("contact_id"), // Phase 3 (contacts)
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const visits = pgTable(
  "visits",
  {
    ...base,
    // null for anonymous "Anyone with link" visits
    visitorId: uuid("visitor_id").references(() => visitors.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    ip: text("ip"),
    country: text("country"),
    device: text("device"),
    userAgent: text("user_agent"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("visits_visitor_idx").on(t.visitorId),
    index("visits_link_idx").on(t.linkId),
    index("visits_started_idx").on(t.startedAt),
  ],
);

export const viewEvents = pgTable(
  "view_events",
  {
    ...base,
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull().default(1),
    secondsViewed: integer("seconds_viewed").notNull().default(0),
  },
  (t) => [
    uniqueIndex("view_events_visit_page_idx").on(t.visitId, t.documentVersionId, t.pageNumber),
    index("view_events_version_idx").on(t.documentVersionId),
  ],
);

export const downloads = pgTable(
  "downloads",
  {
    ...base,
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("downloads_visit_idx").on(t.visitId)],
);

export const accessRequests = pgTable(
  "access_requests",
  {
    ...base,
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    type: requestTypeEnum("type").notNull(),
    // set for download requests
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    status: requestStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("access_requests_status_idx").on(t.status),
    index("access_requests_visitor_link_idx").on(t.visitorId, t.linkId),
  ],
);

export const questionnaireAnswers = pgTable(
  "questionnaire_answers",
  {
    ...base,
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<Record<string, string>>().notNull(),
  },
  (t) => [uniqueIndex("questionnaire_visitor_link_idx").on(t.visitorId, t.linkId)],
);

export const signatures = pgTable(
  "signatures",
  {
    ...base,
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id, { onDelete: "restrict" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    linkId: uuid("link_id").references(() => links.id, { onDelete: "set null" }),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    company: text("company"),
    ip: text("ip"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    signedPdfKey: text("signed_pdf_key"),
  },
  (t) => [index("signatures_visitor_idx").on(t.visitorId)],
);

// Email verification codes for the "Verified email" toggle.
export const verificationCodes = pgTable(
  "verification_codes",
  {
    ...base,
    email: text("email").notNull(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("verification_codes_email_link_idx").on(t.email, t.linkId)],
);

// ---------------------------------------------------------------- platform

// Insert-only. A trigger in the migrations rejects UPDATE and DELETE (NFR-12).
export const auditLog = pgTable(
  "audit_log",
  {
    ...base,
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label"), // email at the time of the action
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_action_idx").on(t.action),
  ],
);

export type Brand = {
  companyName: string;
  primaryColor: string;
  accentColor: string;
  logoKey?: string | null;
};

export const settings = pgTable("settings", {
  ...base,
  brand: jsonb("brand").$type<Brand>().notNull(),
  domain: text("domain"),
  retentionDays: integer("retention_days"),
  emailTemplates: jsonb("email_templates").$type<Record<string, unknown>>(),
});

export const rateLimits = pgTable("rate_limits", {
  ...base,
  key: text("key").notNull().unique(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type Link = typeof links.$inferSelect;
export type Visitor = typeof visitors.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type Folder = typeof folders.$inferSelect;

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** People who can log in. */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** An uploaded map / scan / survey file. */
export const maps = pgTable("maps", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  /** key used to fetch the bytes from blob storage */
  blobKey: text("blob_key").notNull(),
  /** image | pdf | data | gis */
  kind: text("kind").notNull().default("image"),
  /** cached text/vision analysis so we don't re-run it every message */
  analysis: text("analysis"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Chat messages tied to a specific map. */
export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** user | assistant */
  role: text("role").notNull(),
  content: text("content").notNull(),
  /** JSON-encoded VisionStep[] for assistant messages (the zoom crops + lookups) */
  meta: text("meta"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Raw bytes of uploaded files, stored as base64 in the database.
 * Serverless hosts (Vercel/Netlify) have no persistent writable disk, so we
 * keep file contents here instead of on the filesystem. Keyed by maps.blobKey.
 */
export const fileBlobs = pgTable("file_blobs", {
  key: text("key").primaryKey(),
  dataBase64: text("data_base64").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Reports the AI agent composed and generated (downloadable as Word/PDF). */
export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  docxKey: text("docx_key").notNull(),
  pdfKey: text("pdf_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type MapRow = typeof maps.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

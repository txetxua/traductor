import { pgTable, text, timestamp, serial } from "drizzle-orm/pg-core";

// Definición de la tabla Calls
export const calls = pgTable("calls", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Definición de la tabla Translations
export const translations = pgTable("translations", {
  id: serial("id").primaryKey(),
  callId: text("call_id").notNull(),
  originalText: text("original_text").notNull(),
  translatedText: text("translated_text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tipos en TypeScript para Drizzle ORM
export type Call = typeof calls.$inferSelect;
export type InsertCall = typeof calls.$inferInsert;
export type Translation = typeof translations.$inferSelect;
export type InsertTranslation = typeof translations.$inferInsert;

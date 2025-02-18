import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const calls = pgTable("calls", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").notNull().unique(),
  videoEnabled: boolean("video_enabled").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const translations = pgTable("translations", {
  id: serial("id").primaryKey(),
  callId: serial("call_id").references(() => calls.id),
  sourceText: text("source_text").notNull(),
  translatedText: text("translated_text").notNull(),
  fromLanguage: text("from_language").notNull(),
  toLanguage: text("to_language").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCallSchema = createInsertSchema(calls).pick({
  roomId: true,
  videoEnabled: true,
});

export const insertTranslationSchema = createInsertSchema(translations).pick({
  callId: true,
  sourceText: true,
  translatedText: true,
  fromLanguage: true,
  toLanguage: true,
});

export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;
export type InsertTranslation = z.infer<typeof insertTranslationSchema>;
export type Translation = typeof translations.$inferSelect;
export type Language = "es" | "it";

export type TranslationMessage = {
  type: "translation";
  text: string;
  from: Language;
  translated: string;
};

export type SignalingMessage = {
  type: "offer" | "answer" | "ice-candidate";
  payload: any;
};
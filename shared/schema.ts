import { pgTable, text, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const calls = pgTable("calls", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").notNull().unique(),
  videoEnabled: boolean("video_enabled").notNull().default(true),
  active: boolean("active").notNull().default(true),
});

export const insertCallSchema = createInsertSchema(calls).pick({
  roomId: true,
  videoEnabled: true,
});

export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

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

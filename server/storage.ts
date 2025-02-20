import { calls, translations, type Call, type InsertCall, type Translation, type InsertTranslation } from "../shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

// Obtener una llamada por roomId
export async function getCallByRoomId(roomId: string) {
  return await db.select().from(calls).where(eq(calls.roomId, roomId));
}

// Guardar una nueva llamada
export async function saveCall(call: InsertCall) {
  return await db.insert(calls).values(call);
}

// Obtener traducciones por callId
export async function getTranslationsByCallId(callId: string) {
  return await db.select().from(translations).where(eq(translations.callId, callId));
}

// Guardar una nueva traducción
export async function saveTranslation(translation: InsertTranslation) {
  return await db.insert(translations).values(translation);
}

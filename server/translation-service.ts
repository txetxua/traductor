import { db } from "./db"; // Agregar esta línea
import { translations } from "../shared/schema"; // Mantener esta línea

export async function translateText(callId: string, originalText: string, translatedText: string) {
  return await db.insert(translations).values({
    callId,
    originalText,
    translatedText,
  });
}

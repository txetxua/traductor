import { translations } from "../shared/schema"; // Se usa una importación relativa correcta

export async function translateText(callId: string, originalText: string, translatedText: string) {
  return await db.insert(translations).values({
    callId,
    originalText,
    translatedText,
  });
}

import OpenAI from "openai";
import { type Language } from "@shared/schema";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is not set");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function translateText(text: string, from: Language, to: Language): Promise<string> {
  if (from === to) return text;

  try {
    console.log(`[Translation Service] Translating from ${from} to ${to}: "${text}"`);

    const prompt = `Translate the following ${from === "es" ? "Spanish" : "Italian"} text to ${to === "es" ? "Spanish" : "Italian"}. Maintain the original meaning and tone:

Text: "${text}"

Translation:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a professional translator specialized in Spanish and Italian. Provide direct translations without explanations or additional comments."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    const translation = response.choices[0].message.content?.trim() || text;
    console.log(`[Translation Service] Translation result: "${translation}"`);
    return translation;

  } catch (error: any) {
    console.error("[Translation Service] Error:", error);
    throw new Error(`Translation failed: ${error.message}`);
  }
}
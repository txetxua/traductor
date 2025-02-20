import { calls, translations, type Call, type InsertCall, type Translation, type InsertTranslation } from "../shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface ICallStorage {
  createCall(call: InsertCall): Promise<Call>;
  getCall(roomId: string): Promise<Call | undefined>;
  updateCallStatus(roomId: string, active: boolean): Promise<void>;
  createTranslation(translation: InsertTranslation): Promise<Translation>;
  getCallTranslations(callId: number): Promise<Translation[]>;
}

export class DatabaseStorage implements ICallStorage {
  async createCall(insertCall: InsertCall): Promise<Call> {
    const [call] = await db
      .insert(calls)
      .values(insertCall)
      .returning();
    return call;
  }

  async getCall(roomId: string): Promise<Call | undefined> {
    const [call] = await db
      .select()
      .from(calls)
      .where(eq(calls.roomId, roomId));
    return call;
  }

  async updateCallStatus(roomId: string, active: boolean): Promise<void> {
    await db
      .update(calls)
      .set({ active })
      .where(eq(calls.roomId, roomId));
  }

  async createTranslation(translation: InsertTranslation): Promise<Translation> {
    const [newTranslation] = await db
      .insert(translations)
      .values(translation)
      .returning();
    return newTranslation;
  }

  async getCallTranslations(callId: number): Promise<Translation[]> {
    return await db
      .select()
      .from(translations)
      .where(eq(translations.callId, callId));
  }
}

export const callStorage = new DatabaseStorage();
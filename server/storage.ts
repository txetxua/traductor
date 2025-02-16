import { calls, type Call, type InsertCall } from "@shared/schema";

export interface ICallStorage {
  createCall(call: InsertCall): Promise<Call>;
  getCall(roomId: string): Promise<Call | undefined>;
  updateCallStatus(roomId: string, active: boolean): Promise<void>;
}

export class MemCallStorage implements ICallStorage {
  private calls: Map<string, Call>;
  private currentId: number;

  constructor() {
    this.calls = new Map();
    this.currentId = 1;
  }

  async createCall(insertCall: InsertCall): Promise<Call> {
    const id = this.currentId++;
    const call: Call = { 
      id, 
      roomId: insertCall.roomId,
      videoEnabled: insertCall.videoEnabled ?? true,
      active: true 
    };
    this.calls.set(call.roomId, call);
    return call;
  }

  async getCall(roomId: string): Promise<Call | undefined> {
    return this.calls.get(roomId);
  }

  async updateCallStatus(roomId: string, active: boolean): Promise<void> {
    const call = this.calls.get(roomId);
    if (call) {
      call.active = active;
      this.calls.set(roomId, call);
    }
  }
}

export const callStorage = new MemCallStorage();
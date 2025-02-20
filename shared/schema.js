"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.translations = exports.calls = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
// Definición de la tabla Calls
exports.calls = (0, pg_core_1.pgTable)("calls", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    roomId: (0, pg_core_1.text)("room_id").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
});
// Definición de la tabla Translations
exports.translations = (0, pg_core_1.pgTable)("translations", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    callId: (0, pg_core_1.text)("call_id").notNull(),
    originalText: (0, pg_core_1.text)("original_text").notNull(),
    translatedText: (0, pg_core_1.text)("translated_text").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
});

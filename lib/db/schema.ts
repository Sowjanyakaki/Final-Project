import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/**
 * SQLite stand-in for the Postgres+pgvector schema in docs/ARCHITECTURE.md §4.
 * Table/column names match that doc so this swaps in for a real Postgres
 * instance later without touching application code. `embedding` is stored
 * as a JSON-encoded number[] here instead of a native `vector(384)` column.
 */

export const listings = sqliteTable('listings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceUrl: text('source_url').notNull().unique(),
  societyName: text('society_name'),
  locality: text('locality'),
  lat: real('lat'),
  lng: real('lng'),
  rent: integer('rent'),
  bedrooms: integer('bedrooms'),
  furnishing: text('furnishing'),
  amenities: text('amenities', { mode: 'json' }).$type<string[]>().notNull().default([]),
  sqft: integer('sqft'),
  availabilityStatus: text('availability_status', { enum: ['available', 'not_for_rent'] }).notNull(),
  scrapedAt: integer('scraped_at', { mode: 'timestamp' }).notNull(),
});

export const neighborhoodDocs = sqliteTable('neighborhood_docs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  locality: text('locality').notNull(),
  sourceTitle: text('source_title').notNull(),
  sourceUrl: text('source_url').notNull(),
  chunkText: text('chunk_text').notNull(),
  embedding: text('embedding', { mode: 'json' }).$type<number[]>(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  constraints: text('constraints', { mode: 'json' }).$type<Record<string, unknown>>(),
  status: text('status').notNull(),
});

export const shortlistItems = sqliteTable('shortlist_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  listingId: integer('listing_id').notNull().references(() => listings.id),
  status: text('status', { enum: ['active', 'dropped'] }).notNull(),
  reason: text('reason'),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
});

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const toolCallLog = sqliteTable('tool_call_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  toolName: text('tool_name').notNull(),
  input: text('input', { mode: 'json' }).$type<Record<string, unknown>>(),
  output: text('output', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const bookings = sqliteTable('bookings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  listingId: integer('listing_id').notNull().references(() => listings.id),
  confirmationCode: text('confirmation_code').notNull(),
  holdId: text('hold_id'),
  slotStartIso: text('slot_start_iso'),
  slotLabel: text('slot_label'),
  status: text('status', { enum: ['tentative', 'cancelled', 'rescheduled'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const url = process.env.DATABASE_URL ?? 'file:./data/nextleap.db';
const filePath = url.replace(/^file:/, '');
mkdirSync(dirname(filePath), { recursive: true });

const sqlite = new Database(filePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

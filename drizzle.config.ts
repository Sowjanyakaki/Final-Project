import { defineConfig } from 'drizzle-kit';

const url = (process.env.DATABASE_URL ?? 'file:./data/nextleap.db').replace(/^file:/, '');

export default defineConfig({
  dialect: 'sqlite',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
});

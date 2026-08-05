import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const raw = readFileSync(".dev.vars", "utf8");
const match = raw.match(/^DATABASE_URL=(.+)$/m);
if (!match) throw new Error("DATABASE_URL missing in .dev.vars");
let url = match[1].trim();
if (
  (url.startsWith('"') && url.endsWith('"')) ||
  (url.startsWith("'") && url.endsWith("'"))
) {
  url = url.slice(1, -1);
}

const sql = neon(url);
const rows = await sql`select 1 as ok`;
console.log("neon_ok", rows[0]);

await sql`
  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    marketplace TEXT NOT NULL,
    ean TEXT NOT NULL,
    fsn TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    source_file TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_marketplace_ean ON products(marketplace, ean)`;
await sql`
  CREATE TABLE IF NOT EXISTS packaging_runs (
    id SERIAL PRIMARY KEY,
    marketplace TEXT NOT NULL,
    source_sheet TEXT NOT NULL,
    format_sheet TEXT NOT NULL,
    source_file TEXT NOT NULL,
    label_count INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;
await sql`CREATE INDEX IF NOT EXISTS idx_packaging_runs_created ON packaging_runs(created_at)`;

const count = await sql`select count(*)::int as n from products`;
console.log("products_count", count[0].n);
console.log("schema_ready");

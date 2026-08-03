import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  marketplace: text("marketplace").notNull(),
  ean: text("ean").notNull(),
  fsn: text("fsn").notNull(),
  sku: text("sku").notNull().default(""),
  title: text("title").notNull().default(""),
  brand: text("brand").notNull().default(""),
  payload: text("payload").notNull(),
  sourceFile: text("source_file").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_products_marketplace_ean").on(table.marketplace, table.ean),
  index("idx_products_ean").on(table.ean),
  index("idx_products_fsn").on(table.fsn),
  index("idx_products_sku").on(table.sku),
]);

export const packagingRuns = sqliteTable("packaging_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  marketplace: text("marketplace").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  formatSheet: text("format_sheet").notNull(),
  sourceFile: text("source_file").notNull(),
  labelCount: integer("label_count").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_packaging_runs_created").on(table.createdAt)]);

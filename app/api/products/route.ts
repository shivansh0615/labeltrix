import { and, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { products } from "../../../db/schema";
import {
  AuthError,
  authErrorResponse,
  requireAdmin,
  requireSession,
} from "../../lib/auth";

async function ensureSchema() {
  const db = getDb();
  await db.run(sql`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  )`);
  await db.run(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_marketplace_ean ON products(marketplace, ean)`,
  );
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean)`,
  );
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_products_fsn ON products(fsn)`,
  );
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)`,
  );
  return db;
}

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const db = await ensureSchema();
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const where = q
      ? or(
          like(products.ean, `%${q}%`),
          like(products.fsn, `%${q}%`),
          like(products.sku, `%${q}%`),
          like(products.title, `%${q}%`),
          like(products.brand, `%${q}%`),
        )
      : undefined;
    const rows = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(products.id)
      .limit(10000);
    return Response.json({
      products: rows.map((row) => ({
        ...row,
        payload: JSON.parse(row.payload),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load products",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const db = await ensureSchema();
    const body = (await request.json()) as {
      products?: Array<Record<string, unknown>>;
    };
    const incoming = body.products ?? [];
    if (!incoming.length)
      return Response.json({ error: "No product rows found" }, { status: 400 });
    let saved = 0;
    for (const raw of incoming) {
      const marketplace = String(raw.marketplace ?? "");
      const ean = String(raw.ean ?? "");
      const fsn = String(raw.fsn ?? "");
      if (!marketplace || !ean || !fsn) continue;
      const values = {
        marketplace,
        ean,
        fsn,
        sku: String(raw.sku ?? ""),
        title: String(raw.title ?? ""),
        brand: String(raw.brand ?? ""),
        payload: JSON.stringify(raw.payload ?? {}),
        sourceFile: String(raw.sourceFile ?? ""),
        updatedAt: new Date().toISOString(),
      };
      const existing = await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(eq(products.marketplace, marketplace), eq(products.ean, ean)),
        )
        .limit(1);
      if (existing.length)
        await db
          .update(products)
          .set(values)
          .where(eq(products.id, existing[0].id));
      else await db.insert(products).values(values);
      saved++;
    }
    return Response.json({ saved });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 },
    );
  }
}

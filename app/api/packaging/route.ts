import { desc, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { packagingRuns } from "../../../db/schema";
import {
  AuthError,
  authErrorResponse,
  requireAdmin,
  requireSession,
} from "../../lib/auth";

async function ensureSchema() {
  const db = getDb();
  await db.run(sql`CREATE TABLE IF NOT EXISTS packaging_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    marketplace TEXT NOT NULL,
    source_sheet TEXT NOT NULL,
    format_sheet TEXT NOT NULL,
    source_file TEXT NOT NULL,
    label_count INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_packaging_runs_created ON packaging_runs(created_at)`,
  );
  return db;
}

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const db = await ensureSchema();
    const rows = await db
      .select()
      .from(packagingRuns)
      .orderBy(desc(packagingRuns.createdAt), desc(packagingRuns.id))
      .limit(50);
    return Response.json({
      runs: rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) })),
    });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load packaging history",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const db = await ensureSchema();
    const body = (await request.json()) as Record<string, unknown>;
    const marketplace = String(body.marketplace ?? "");
    const sourceSheet = String(body.sourceSheet ?? "");
    const formatSheet = String(body.formatSheet ?? "");
    const sourceFile = String(body.sourceFile ?? "");
    const payload = Array.isArray(body.payload) ? body.payload : [];
    if (
      !marketplace ||
      !sourceSheet ||
      !formatSheet ||
      !sourceFile ||
      !payload.length
    ) {
      return Response.json(
        { error: "The packaging workbook could not be read" },
        { status: 400 },
      );
    }
    const [run] = await db
      .insert(packagingRuns)
      .values({
        marketplace,
        sourceSheet,
        formatSheet,
        sourceFile,
        labelCount: payload.length,
        payload: JSON.stringify(payload),
      })
      .returning();
    return Response.json({ run: { ...run, payload } }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Packaging import failed",
      },
      { status: 500 },
    );
  }
}

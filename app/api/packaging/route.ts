import { desc, eq, sql } from "drizzle-orm";
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
  await db.execute(sql`CREATE TABLE IF NOT EXISTS packaging_runs (
    id SERIAL PRIMARY KEY,
    marketplace TEXT NOT NULL,
    source_sheet TEXT NOT NULL,
    format_sheet TEXT NOT NULL,
    source_file TEXT NOT NULL,
    label_count INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(
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

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    const db = await ensureSchema();
    const body = (await request.json()) as {
      id?: unknown;
      indexes?: unknown;
    };
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json(
        { error: "Choose a packaging run to delete." },
        { status: 400 },
      );
    }
    const existing = await db
      .select()
      .from(packagingRuns)
      .where(eq(packagingRuns.id, id))
      .limit(1);
    if (!existing.length) {
      return Response.json(
        { error: "That packaging run was not found." },
        { status: 404 },
      );
    }
    const indexes = Array.isArray(body.indexes)
      ? [
          ...new Set(
            body.indexes
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value >= 0),
          ),
        ]
      : [];
    if (indexes.length) {
      let payload: unknown[] = [];
      try {
        const parsed = JSON.parse(existing[0].payload);
        payload = Array.isArray(parsed) ? parsed : [];
      } catch {
        payload = [];
      }
      const remove = new Set(indexes);
      const nextPayload = payload.filter((_, index) => !remove.has(index));
      const deleted = payload.length - nextPayload.length;
      if (!deleted) {
        return Response.json(
          { error: "None of the selected packaging labels were found." },
          { status: 400 },
        );
      }
      if (!nextPayload.length) {
        await db.delete(packagingRuns).where(eq(packagingRuns.id, id));
        return Response.json({ deleted, id, run: null });
      }
      const [run] = await db
        .update(packagingRuns)
        .set({
          payload: JSON.stringify(nextPayload),
          labelCount: nextPayload.length,
        })
        .where(eq(packagingRuns.id, id))
        .returning();
      return Response.json({
        deleted,
        id,
        run: { ...run, payload: nextPayload },
      });
    }
    await db.delete(packagingRuns).where(eq(packagingRuns.id, id));
    return Response.json({ deleted: 1, id, run: null });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to delete packaging run",
      },
      { status: 500 },
    );
  }
}

# LabelTrix

Flipkart Alpha / FBF label tool: upload Excel product masters and packaging runs, search and preview labels, then download sharp vector PDFs or print.

Stack: [vinext](https://github.com/cloudflare/vinext) (Next on Cloudflare Workers) + Neon Postgres (Drizzle) + pdf-lib / JsBarcode.

## Prerequisites

- Node.js `>=22.13.0`
- A [Neon](https://neon.tech) project (free tier is enough for typical use)

## Quick start

```bash
npm install
```

1. Copy env template values into **`.dev.vars`** (local secrets; gitignored):

```bash
# .dev.vars
LABELTRIX_ADMIN_PASSWORD=your-admin-password
LABELTRIX_VIEWER_PASSWORD=your-viewer-password
LABELTRIX_AUTH_SECRET=change-me-to-a-long-random-string
DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

See [`.env.example`](.env.example) for the same keys.

2. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in, upload product / packaging Excel files.

Tables are created automatically on first API use (`CREATE TABLE IF NOT EXISTS`).

## What it does

| Area | Description |
|------|-------------|
| **Product Master** | One-time barcode workbooks (Alpha EAN / FBF FSN). Search, multi-select, download PDF, delete (admin). |
| **Packaging** | Recurring non-barcode box labels. Preview runs, download PDF, delete run (admin). |
| **Label sizes** | `3x5`, `3x4`, `3x3` (inches). |
| **PDF** | Client-side vector PDF (`app/lib/vector-label-pdf.ts`) — Helvetica text + embedded barcodes, Terry Blue–style grid. |
| **Auth** | Shared role passwords: **Admin** (upload/delete) and **Viewer** (view/download/print). |

## Environment variables

| Variable | Required | Where |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Neon connection string |
| `LABELTRIX_ADMIN_PASSWORD` | Yes | Admin login |
| `LABELTRIX_VIEWER_PASSWORD` | Yes | Viewer login |
| `LABELTRIX_AUTH_SECRET` | Yes | Signs session cookies |

**Local:** put them in `.dev.vars` (not `.env`). Wrangler/vinext loads `.dev.vars` for `npm run dev`.

**Production (APICloud / host):** set the same keys as secrets/env vars in the dashboard — at minimum `DATABASE_URL` after the Neon migration. Redeploy after changing secrets.

Do not commit `.dev.vars` or real connection strings.

## Database (Neon)

- Schema: [`db/schema.ts`](db/schema.ts) (Postgres via Drizzle)
- Client: [`db/index.ts`](db/index.ts) (`@neondatabase/serverless` + `drizzle-orm/neon-http`)
- APIs: [`app/api/products/route.ts`](app/api/products/route.ts), [`app/api/packaging/route.ts`](app/api/packaging/route.ts)

Data lives in Neon, so redeploying the app does **not** wipe products/packaging (as long as production uses the same `DATABASE_URL`).

Practical UI load limit: **10,000** products per list request. Packaging history: latest **50** runs.

## Project layout

```
app/                  UI + API routes
app/lib/auth.ts       Session / role passwords
app/lib/vector-label-pdf.ts   Vector label PDF builder
db/                   Neon + Drizzle schema
scripts/dev.mjs       Local dev (app + PDF helper)
.openai/hosting.json  Sites hosting (D1 disabled; data is Neon)
.dev.vars             Local secrets (gitignored)
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local development |
| `npm run build` | Production build |
| `npm start` | Run built app |
| `npm test` | Build + smoke tests |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate Drizzle migrations after schema edits |

## Deploy notes

1. Push code to your Git remote (GitLab / etc.).
2. On the host, set `DATABASE_URL` (and auth secrets if not already set).
3. Redeploy.
4. Re-upload Excel masters once on the live URL if the Neon DB is new.

Local Neon data and production Neon data are the same only if both use the **same** `DATABASE_URL`.

## Roles

- **Admin** — upload, delete, full tools  
- **Viewer** — view, search, download PDF, print  

Sessions are cookie-based HMAC tokens (`LABELTRIX_AUTH_SECRET`).

## Learn more

- [vinext](https://github.com/cloudflare/vinext)
- [Neon](https://neon.tech/docs)
- [Drizzle + Neon](https://orm.drizzle.team/docs/get-started/neon-new)
- [pdf-lib](https://pdf-lib.js.org/)

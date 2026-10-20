# Data Room

Internal data room for sharing confidential documents with investors: protected links, NDA gate, watermarking, page-level analytics and a tamper-proof audit log. Built from the *Data Room System — BRD v1.0*. This repository is **Phase 1** (secure sharing + analytics).

Stack: Next.js 16 (App Router, TypeScript) · Tailwind CSS · Drizzle ORM · Neon Postgres · S3/R2 private storage · Resend · deployed on Vercel from GitHub.

---

## Run it locally

Requires Node 20.9+.

```bash
npm install
cp .env.example .env.local          # then fill in APP_SECRET (and DATABASE_URL, see below)
npm run db:migrate
npm run dev                          # http://localhost:3000 → first visit opens /setup
```

**Database.** Put your Neon *pooled* connection string in `DATABASE_URL`. If you just want to click around offline, `DATABASE_URL=pglite:./.data/pglite` runs an in-process Postgres with no server. Use Neon for anything shared.

**Email in development.** With `EMAIL_DRIVER=console`, emails (verification codes, invites, notifications) are printed to the terminal and saved as HTML in `.data/outbox/`.

**Files in development.** With `STORAGE_DRIVER=local`, uploads go to `.data/uploads/` and are served through short-lived signed URLs, the same way S3 works in production.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Unit tests, including the access-rule matrix and DB-level audit-log guarantees |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:generate` | Create a migration after changing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (also runs automatically in `npm run build`) |
| `npm run build` | Migrate, then production build (this is what Vercel runs) |

---

## Deploy (GitHub → Vercel → Neon)

1. **GitHub**: push this repo to the company organisation. Protect `main` (require PR review and the *CI* check).
2. **Vercel**: import the repo. Region **fra1** (Frankfurt), next to Neon `aws-eu-central-1`.
3. **Neon**: add the Neon integration in Vercel. It sets `DATABASE_URL` / `DATABASE_URL_UNPOOLED` and creates a database branch for every preview deployment, so migrations on a PR never touch production. Turn on point-in-time restore (NFR-09).
4. **Storage**: create a **private** bucket (AWS S3 `eu-central-1`, or Cloudflare R2). Set `STORAGE_DRIVER=s3` and the `S3_*` variables. Add a CORS rule so browsers can upload directly and the viewer can read:
   ```json
   [{ "AllowedOrigins": ["https://dataroom.yourcompany.com"], "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 600 }]
   ```
5. **Email**: create a Resend account, verify the company domain (SPF, DKIM, DMARC), set `EMAIL_DRIVER=resend`, `RESEND_API_KEY` and `EMAIL_FROM`.
6. **Secrets**: set `APP_SECRET` (32+ random chars) and `APP_URL` in Vercel. Never commit them (NFR-04). `.env*` is git-ignored.
7. Open the production URL. The first visit runs `/setup` to create the Owner account, then requires 2FA.

---

## How access works

Every visitor request goes through one check (`src/lib/access/guard.ts` → `engine.ts`):

**link live → not expired → email → verified code → allowed list → visitor not suspended/revoked → password → NDA → questionnaire → manual approval → document inside this link's scope → active visit**

- Files are never public. A visitor's file URL (`/api/v/<slug>/file/<id>`) re-runs this check on every request and only then redirects to a signed storage URL valid for **5 minutes** (NFR-02). Disabling a link or revoking a visitor takes effect on the next request.
- Visitor progress lives in a signed, HTTP-only cookie per link. Everything revocable (link status, visitor status, approvals, NDA signatures) is re-read from the database every time.
- Conflicting toggles (e.g. *Anyone with link* + *Allowed list*) are blocked in the UI and again on the server (`validateLinkSettings`).
- `tests/access-engine.test.ts` brute-forces every combination of gates and asserts the security invariants (BRD risk: "access-rule bug exposes a document").
- The audit log is insert-only, enforced by a Postgres trigger (`drizzle/0001_audit_log_immutable.sql`), so no role and no code path can edit or delete entries.

---

## Phase 1 status against the BRD

✅ done · ⚠️ partial / see note · ⏭️ later phase per BRD §9

| ID | Requirement | Status |
| --- | --- | --- |
| FR-01 | Email + password + 2FA (TOTP, enforced at first sign-in) | ✅ |
| FR-02 | Invite members, roles Owner/Admin/Editor/Viewer | ✅ |
| FR-03 | Session timeout (12 h fixed) / allowed IPs | ⚠️ timeout fixed at 12 h; configurable + IP allow-list in Phase 3 |
| FR-10 | Folders, drag-and-drop files **and folders** | ✅ |
| FR-11 | PDF, Office, images, video | ⚠️ all upload; PDF/image/video view in browser. Office→PDF (Gotenberg) is Phase 2, so Office files show "no preview" for now |
| FR-12 | New versions; links show latest | ✅ |
| FR-13 | Full-text search | ⏭️ Phase 2 (`extracted_text` column is ready) |
| FR-20…29 | Links, access toggles, conflict blocking, gates, watermark, screenshot deterrence, downloads (off/allowed/on request), expiry presets, notify on open (per link), disable/delete | ✅ |
| FR-30…35 | Data rooms with sections, numbering, room tabs | ⏭️ Phase 2 (`links.data_room_id` already exists) |
| FR-40…43 | Q&A | ⏭️ Phase 2 |
| FR-44 | Access & download requests on Home, approve/reject with email | ✅ |
| FR-50 | Every view: visitor, document, page, time, device, IP, country | ✅ (country comes from Vercel's geo header in production) |
| FR-51/52 | Dashboard; analytics with date/link/document/visitor filters | ✅ |
| FR-53/54 | Visitors table; suspend / reactivate / revoke / edit | ✅ |
| FR-55 | Visitor profile with full history | ✅ |
| FR-56 | Searchable, exportable audit log | ✅ CSV |
| FR-57 | Export analytics to Excel/PDF | ⚠️ CSV (opens in Excel); formatted PDF report later |
| FR-60/61 | NDA upload with versions; signature record + signed PDF emailed | ✅ |
| FR-70…76 | Contacts, pipeline, investor updates | ⏭️ Phase 3 |
| FR-80 | Logo, colours, company name on visitor pages and emails | ✅ |
| FR-81 | Custom domain | ⏭️ Phase 2 (Vercel domain + DNS) |
| FR-82…85 | Notification prefs, retention/deletion, storage, delete workspace | ⏭️ Phase 2/3 |
| FR-90…92 | Branded landing with privacy notice, gates in order, mobile viewer, clear expired/revoked/pending/rejected pages | ✅ |
| Arabic / English visitor pages (RTL) | ✅ (Arabic wording needs a native-speaker review) |

### Decisions worth knowing

- **Watermark + downloads.** The BRD requires a watermark on *every* downloaded file. PDFs and images are stamped server-side (images come out as PDFs). Office and video files cannot be stamped yet, so while the watermark is on they are **view-only** until Office→PDF conversion lands in Phase 2.
- **Screenshot deterrence** blurs on focus loss and blocks print and capture shortcuts. A browser cannot prevent screenshots or phone photos. The watermark is what makes leaks traceable (BRD risk table).
- **NDA** is click-to-accept with typed name, IP and timestamp, plus a certificate page appended to the signed PDF. The legal advisor should confirm this is sufficient (BRD risk).
- **New NDA version.** Uploading an agreement with an existing name creates version *n+1*. Links switch to it, so returning visitors accept the new text.
- **Hosting region.** Frankfurt. If legal decides PDPL requires data inside Saudi Arabia, the stack changes (BRD §7 / risks). Get that decision before going live.

## Project layout

```
src/
  app/(auth)/        setup, login, 2FA, invite
  app/(admin)/       team app: home, documents, links, analytics, visitors, audit, settings
  app/v/[slug]/      visitor pages (gates, document list, viewer)
  app/api/           uploads, signed file access, tracking, exports
  lib/access/        settings + conflict rules, gate engine, scope, visitor cookie, guard
  lib/db/            Drizzle schema and client
  components/viewer/ PDF/image/video viewer, watermark overlay, screenshot deterrence
drizzle/             SQL migrations
tests/               Vitest
```

# Deploy

This repo ships in two pieces:

| Piece            | What it is                            | Host                          |
| ---------------- | ------------------------------------- | ----------------------------- |
| `apps/web`       | Next.js marketing site + Clerk auth   | **Vercel**                    |
| repo root (lurq) | Data pipeline (Postgres + `lurq sync`)| **Railway** (Postgres + cron) |

> The backend is a CLI + **stdio** MCP server, not an HTTP API. Nothing on the
> public internet calls it, so Railway only hosts the database and a scheduled
> job that keeps scores fresh. (If the website later needs live data, add an
> HTTP API — see "Future: HTTP API" at the bottom.)

---

## 0. Push everything to GitHub first

Both platforms deploy from `github.com/jadenryu/lurq`, so the working tree must
be committed and pushed (the `apps/` folder is new).

```bash
git add -A
git commit -m "Add web app + Railway deploy config"
git push
```

---

## 1. Frontend → Vercel

1. <https://vercel.com> → **Add New… → Project** → import `jadenryu/lurq`.
2. **Root Directory → `apps/web`** (this is the one setting people miss in a
   monorepo). Framework auto-detects as Next.js.
3. **Environment Variables** — copy from `apps/web/.env.local`, but use your
   **production** Clerk instance keys:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
   - `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`
   - `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`
4. **Deploy**, then verify the `*.vercel.app` URL.
5. In the **Clerk dashboard**, create/enable a **Production** instance and add
   your custom domain there, or auth breaks on the real domain.

---

## 2. Backend → Railway (Postgres + scheduled sync)

### 2a. Database

1. <https://railway.app> → **New Project**.
2. Add a **pgvector**-enabled Postgres: **Deploy from Template → "pgvector"**
   (the plain Postgres image may not ship the `vector` extension, which the
   schema requires).
3. Open the Postgres service → **Variables/Connect** → copy the
   **public** `DATABASE_URL` (used for the one-time migrate below).

### 2b. One-time migrate + seed (run from your laptop)

This creates the `vector` extension, applies migrations, and loads the seed
list. Run it once against the Railway DB:

```bash
DATABASE_URL="<railway-public-DATABASE_URL>" npm run db:migrate
```

### 2c. Sync service (cron)

1. In the **same Railway project**: **New → GitHub Repo** → `jadenryu/lurq`.
   - **Root directory = repo root** (NOT `apps/web`).
   - `railway.json` is already committed, so build (`npm run build`), the
     `lurq sync` start command, and the daily `0 6 * * *` cron schedule are
     picked up automatically.
2. Service **Variables**:
   - `DATABASE_URL` → reference the DB service: `${{Postgres.DATABASE_URL}}`
     (use the **internal** reference here, not the public URL).
   - `GITHUB_TOKEN` → recommended; without it GitHub signals are skipped and
     scores drop. Create at <https://github.com/settings/tokens> (no scopes
     needed for public data).
   - *(optional)* `EMBEDDING_API_KEY`, `SUMMARY_API_KEY` — both degrade
     gracefully if omitted (see `.env.example`).
3. Deploy. Because `restartPolicyType` is `NEVER` and a `cronSchedule` is set,
   Railway runs `lurq sync` to completion on schedule and the container exits —
   you only pay for run time, not idle.

To run a sync immediately the first time, open the service → **Deployments →
Run** (or trigger the cron manually).

---

## 3. Domain → Namecheap

Namecheap → **Domain List → Manage → Advanced DNS**. Delete the default
parking/CNAME records first.

**Frontend (Vercel):** add your domain in Vercel (**Project → Settings →
Domains**) — it shows the exact records. Typically:

| Type  | Host  | Value                    |
| ----- | ----- | ------------------------ |
| A     | `@`   | `76.76.21.21`            |
| CNAME | `www` | `cname.vercel-dns.com.`  |

Vercel issues SSL automatically once DNS resolves (minutes to ~1 hour).

**Backend:** nothing — Option A has no public web endpoint, so no DNS record.

---

## Future: HTTP API (Option B)

When you want the website to display live recommendations, add an HTTP
entrypoint to lurq (wrapping the same `recommend`/`evaluate`/`compare` logic
in `src/`), give that Railway service a public domain + port, and point a
`CNAME api → <service>.up.railway.app` record at it. The frontend then reads
`NEXT_PUBLIC_API_URL`. Not needed for the current deploy.

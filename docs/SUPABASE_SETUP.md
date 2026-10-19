# Connect QueryPilot X to Supabase

## 1. Deploy to Vercel

Import `dev-fuadhasan/querypilot_x` into Vercel with the **Next.js** framework preset. Set these **server-side environment variables** in Vercel Project → Settings → Environment Variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | Encrypts connected database credentials in HttpOnly cookies; at least 32 unpredictable characters. |
| `OPENAI_API_KEY` | Yes for AI | Lets the model plan safe SELECT queries and explain query results. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4.1-mini`. |
| `APP_URL` | For OAuth | Your exact deployment origin, e.g. `https://your-project.vercel.app`. |
| `SUPABASE_OAUTH_CLIENT_ID` | For OAuth | From your Supabase **organization** OAuth app. |
| `SUPABASE_OAUTH_CLIENT_SECRET` | For OAuth | OAuth app secret; only on the server. |

Generate a session secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Redeploy after configuring variables. Never put secret environment variables under the `NEXT_PUBLIC_` prefix.

## 2. Option A — Official Supabase authorization (recommended)

1. In your Supabase organization's settings, open **OAuth Apps** and create an OAuth app.
2. Configure **Projects: Read** scope. You do not need Database: Write.
3. Register this redirect URI exactly: `https://YOUR-DOMAIN/api/auth/callback`.
4. Add the client ID, client secret, and `APP_URL` in Vercel.
5. Click **Connect your database**. You will be redirected to Supabase to sign in and authorize access.
6. Choose a permitted project when you return to QueryPilot X.
7. Provide that project's PostgreSQL connection string using a limited-access role as described below.

**Important:** Supabase explicitly says Management OAuth cannot reveal an existing project's database password. OAuth enables verified project authorization and selection, but a separate connection string or database password is still required. QueryPilot X drops the temporary Management API token after project discovery.

Official docs: https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration

## 3. Option B — Manual demo connection (no OAuth app required)

If the OAuth environment variables are not configured, the same landing button opens a connection form. You can paste the PostgreSQL URI directly. This verifies access with the database but does not sign you in through Supabase's OAuth screen.

Open Supabase Dashboard → select project → **Connect** → select **Session pooler** (recommended for IPv4), then copy the URI. It resembles:

```text
postgresql://querypilot_reader.PROJECT_REF:ROLE_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

Use the exact host in Supabase's Connect dialog; don't guess the pooler region or number. URLs containing passwords with special characters must percent-encode those characters.

## 4. Create a read-only role for analytics

Run the following **one time** in the project's Supabase SQL Editor, replacing the placeholder password with your own strong secret:

```sql
CREATE ROLE querypilot_reader LOGIN PASSWORD 'REPLACE_WITH_A_STRONG_PASSWORD';
GRANT CONNECT ON DATABASE postgres TO querypilot_reader;
GRANT USAGE ON SCHEMA public TO querypilot_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO querypilot_reader;
```

Optional (for tables created later by the owner who runs this command):

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO querypilot_reader;
```

If you use Row Level Security (RLS), its policies still apply. Configure appropriate SELECT policies for the read-only role or test using a dedicated non-sensitive demonstration dataset. Restrict grants to only the required tables for sensitive projects.

Use `querypilot_reader.PROJECT_REF` as the pooler username with that role's password. In a direct connection, use `querypilot_reader` on `db.PROJECT_REF.supabase.co`. Do **not** paste your Supabase service-role key or API key into the PostgreSQL field; they are different credentials.

## 5. What works in Part 1

- Server-verified Supabase PostgreSQL connection and connected toast.
- OAuth project selection when the OAuth app is configured.
- Schema inspection on every new question.
- Natural-language question to validated PostgreSQL SELECT.
- Follow-up clarification questions with selectable answers.
- Responsive left-side results with KPI cards, tables, automatic line/bar/pie charts and an AI analysis report.
- Displayable SQL for transparency; rows capped at 200; database read-only transaction and query timeout.
- Fixed-viewport split-panel application with independently scrollable content areas.

Scheduled reporting, cron jobs, audit triggers, change alerts and organization-specific RBAC are **later phases**, not included in this portion.

## 6. Security reminders

The database connection string is AES-256-GCM encrypted and stored in a Secure/HttpOnly cookie (Secure applies on HTTPS). Clearing the cookie via Disconnect ends the app's local session. This demo does not have a standalone user-account system, server-side vault, organization isolation, persistent event logging, or cross-user access policies. Do not connect production customer data until those controls, threat modeling and consent requirements are implemented.

Even though SQL execution is restricted to a read-only transaction, use a read-only database role as a second independent safety boundary. AI explanations are based on actual SQL results, but should be checked before consequential business decisions.

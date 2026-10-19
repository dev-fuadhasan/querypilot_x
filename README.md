# QueryPilot X

A minimal, Vercel-ready AI analytics workspace for a connected Supabase PostgreSQL database.

## Setup

1. Deploy this Next.js repository to Vercel or run locally with `npm install && npm run dev`.
2. Add `SESSION_SECRET` (a random secret of at least 32 characters) and `OPENAI_API_KEY` to your environment.
3. For **Connect with Supabase** OAuth, register an OAuth app in Supabase organization settings. Add `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET`, and `APP_URL` (your exact deployed domain). Register `https://YOUR-DOMAIN/api/auth/callback` as its redirect URI.
4. Supabase's Management OAuth does **not** disclose existing database passwords. After OAuth, select a project and paste a PostgreSQL connection string for a dedicated read-only role from Supabase's **Connect → Session pooler** dialog.
5. Without OAuth configuration, the landing button opens a manual connection screen for your Supabase PostgreSQL connection URI.
6. Ask natural-language questions. QueryPilot generates SELECT-only SQL, executes it inside a read-only transaction, and displays results with evidence-grounded analysis.

## Required environment variables

See `.env.example`. Never commit real database credentials or OpenAI keys.

## Security and scope

This is **Part 1** of the capstone: Supabase connection, conversational exploration, clarification questions, charts, result tables and AI report. Scheduled reports and audit alerts are planned for later. There is **no write access** by design; this avoids exposing privileged database credentials or letting AI change records.

Connection strings are encrypted in an HttpOnly, Secure cookie with AES-256-GCM. Vercel functions do not require persistent server storage. Use a dedicated least-privileged database role with only SELECT on the intended tables. The application allows Supabase database and Supabase pooler hostnames only and refuses other server destinations. For a multi-user production deployment, add real application login, durable encrypted connection storage, authorization boundaries and audit logging before accepting sensitive customer data.

Supabase OAuth requires a published OAuth app; **deploying the website alone does not configure Supabase authorization**, and an AI model cannot retrieve database passwords through OAuth. Full administrative access is neither required nor granted.

## Testing

Run `npm run typecheck` and `npm run build`. Query behavior requires a real Supabase database and an OpenAI API key. No sample outputs are presented as real data.

Based on the QueryPilot X project proposal (SE331): the immediate workflow uses approved schema context, read-only SQL, real query results, auto-selected visualizations and grounded interpretations. Other workflows will be added in later phases.

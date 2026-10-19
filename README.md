# QueryPilot X

**Ask your data. Get the story.** A Vercel-ready, black-and-white AI analytics workspace for **any user-authorized Supabase PostgreSQL project**.

## Part 1

- Clean landing page with one black **Connect your database** button and a Supabase icon.
- **Dynamic Supabase OAuth**: each user authorizes their own projects; the app verifies access using Supabase's read-only Management API without requesting the existing database password. Includes a manual read-only PostgreSQL URI fallback if the beta API isn't available.
- Each browser has a separate encrypted HttpOnly session; a user can choose/switch projects.
- Fixed-viewport split dashboard: broad analysis canvas on the left; AI conversation on the right.
- Real server-driven progress animation: inspect schema → generate SQL → validate SQL → execute SQL → build report, including visible validated SQL during execution.
- Schema-aware natural-language-to-SQL with clarification options, SELECT-only validation, database results, tables/KPIs/charts and evidence-based report.
- **Gemini free-tier AI** as the recommended provider and optional **Groq GPT-OSS 120B**, with server-side keys.

## Get started

```sh
npm install
cp .env.example .env.local
npm run dev
```

See **[Deployment and Supabase integration guide](docs/SUPABASE_SETUP.md)** to configure OAuth and Vercel. GitHub Actions verifies the TypeScript check and production build.

### Minimum Vercel secrets

`SESSION_SECRET` and one of `GEMINI_API_KEY` or `GROQ_API_KEY`. For one-click OAuth, also configure `APP_URL`, `SUPABASE_OAUTH_CLIENT_ID`, and `SUPABASE_OAUTH_CLIENT_SECRET`. Without OAuth settings the user can connect manually.

## Scope and limitations

Supabase's OAuth read-only SQL endpoint is **experimental/beta** and requires `projects:read` plus `database:read` scopes. This is a **read-only** analytics prototype, not a database editor. It has not implemented the proposal's cron scheduling, row-level audit triggers, email notifications, production organization RBAC or distributed abuse controls. Avoid connecting sensitive production records before implementing organizational authorization and privacy safeguards.

Gemini free-tier prompts can be used by Google for product improvement, depending on the service terms; do not send sensitive business data through the free tier without an appropriate privacy review.

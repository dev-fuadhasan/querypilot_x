# QueryPilot X — Deployment and automatic Supabase connection

This is a dynamic multi-project Part 1 prototype. **No Supabase project URL, reference, database password or user data is hardcoded.** Each browser has an independent AES-256-GCM encrypted HttpOnly session.

## 1. Deploy the repository

In [Vercel](https://vercel.com), import the GitHub repository `dev-fuadhasan/querypilot_x`; choose Next.js. Configure these **server-side** variables in Vercel Project Settings → Environment Variables, then redeploy:

| Variable | Required | Meaning |
|---|---|---|
| `SESSION_SECRET` | Yes | Cryptographically random secret of at least 32 characters; used to encrypt sessions. |
| `GEMINI_API_KEY` | Gemini | Free-tier Gemini API key from Google AI Studio. |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-3.1-flash-lite`. |
| `GROQ_API_KEY` | Groq | Alternative AI provider (or automatic rate-limit fallback). |
| `GROQ_MODEL` | Optional | Defaults to `openai/gpt-oss-120b`. |
| `AI_PROVIDER` | Optional | `auto` (Gemini first, then Groq for temporary failures), `gemini`, or `groq`. |
| `APP_URL` | For OAuth | Exact deployed origin, e.g. `https://example.vercel.app`, with no trailing slash. |
| `SUPABASE_OAUTH_CLIENT_ID` | For OAuth | Supabase Management OAuth app client ID. |
| `SUPABASE_OAUTH_CLIENT_SECRET` | For OAuth | Supabase Management OAuth app client secret. |

Generate `SESSION_SECRET` locally:

```shell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not put any secret under a `NEXT_PUBLIC_` variable. The app does **not** need `OPENAI_API_KEY`.

### Which AI model should I choose?

- **Recommended:** Gemini 3.1 Flash-Lite, where the Gemini API free tier is available for your account/location. Set `GEMINI_API_KEY`. Model availability and free quotas vary; verify in Google AI Studio.
- **Optional alternative:** Groq's `openai/gpt-oss-120b`, with `GROQ_API_KEY`. Groq's Free plan has separate request and token quotas. The model also has paid pricing outside free allowance.
- If you set both and leave `AI_PROVIDER=auto`, Groq is used only if Gemini reports a temporary outage or rate limit. Do not assume zero cost if billing is enabled on either account.

**Privacy warning:** Gemini's free tier may use submitted prompts/responses to improve its products. Before connecting personal, confidential or customer data, review Google's data usage terms and deploy appropriate AI privacy controls. QueryPilot masks common private columns in report previews, but this is not complete PII detection.

## 2. One-click Supabase connection (OAuth, recommended)

Supabase supports an OAuth integration and a **read-only Management API database query endpoint**, so users do not have to copy or share the project's existing database password.

1. In **Supabase Dashboard → Organization Settings → OAuth Apps**, create an integration and configure the app's name/redirect.
2. Grant **Projects → Read** and **Database → Read** OAuth scopes. **Do not** grant Database → Write, Secrets, or any unrelated scopes.
3. Configure its exact redirect URL: `https://YOUR-DOMAIN/api/auth/callback`.
4. Add `APP_URL`, `SUPABASE_OAUTH_CLIENT_ID`, and `SUPABASE_OAUTH_CLIENT_SECRET` in Vercel.
5. Visit QueryPilot X → **Connect your database** → sign in/authorize on Supabase.
6. When the user has a single readable project, QueryPilot verifies it and opens the workspace automatically. With more than one project, the user selects a project, and QueryPilot verifies it.
7. The app runs the Supabase Management API endpoint `POST /v1/projects/{ref}/database/query/read-only` under that user's OAuth authorization. The selected project is scoped to the signed-in visitor's encrypted session.

**Important:** This read-only SQL endpoint is **beta/experimental**, and some accounts/projects may not support it. Queries have to use fully schema-qualified table names (e.g., `public.orders`). Some Supabase database configurations may hide tables from the read-only user. If you encounter unsupported endpoint / authorization / missing accessible tables, use the manual read-only fallback below.

Sources:
- OAuth integration: https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration
- Supabase database read-only query endpoint: https://supabase.com/docs/reference/api/v1-read-only-query
- Supabase OAuth scopes: https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes

## 3. Manual fallback (works without an OAuth integration)

Users can connect **any standard Supabase PostgreSQL project** through its individual PostgreSQL connection string. QueryPilot accepts only official `db.*.supabase.co` and `*.pooler.supabase.com` endpoints, blocking arbitrary hosts.

1. Open the individual Supabase project → **Connect → Session pooler**.
2. For least privilege, create a read-only database role in that project's SQL editor:

```sql
CREATE ROLE querypilot_reader LOGIN PASSWORD 'USE_A_LONG_RANDOM_PASSWORD';
GRANT CONNECT ON DATABASE postgres TO querypilot_reader;
GRANT USAGE ON SCHEMA public TO querypilot_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO querypilot_reader;
```

3. Replace the role name and password in the pooler connection string. The pooler username should resemble `querypilot_reader.PROJECT_REF`. Percent-encode reserved characters in URI passwords. Click Connect.

Do not paste Supabase API keys or `service_role` keys into the PostgreSQL connection field: they are not SQL connection strings.

## 4. Interaction and AI behavior

After connection, the fixed-height workspace has a **wide left results canvas** and **right conversation panel**:

1. The user asks an ordinary business question. The server inspects the current project's readable table/column schema.
2. Gemini (or Groq) decides whether missing specifics require a follow-up question, offering selectable options.
3. If answerable, the model prepares SQL using actual public table/column names. The server checks that it is a single SELECT statement and only names approved schema tables.
4. The left canvas receives **real progress events**: schema → SQL planning → SQL validation → SQL execution → AI insights. Once the SQL passes validation, a code panel displays it as Supabase begins execution. A "validated" status is **syntactic/safety validation, not a guarantee of correct business logic**.
5. The server executes using a read-only database context, with a cap of 200 displayed rows; figures and cards are selected from actual results.
6. The AI generates an analysis report using a limited preview of the returned data (up to 35 sanitized rows). Results can include KPI cards, tables, bar/line/pie/area/scatter plots and two visualizations when relevant.
7. The original SQL remains visible in the final report for reproducibility. Users can disconnect or choose another project.

Current Part 1 is **read-only**. Scheduled reports (cron), audit triggers for database edits and email alerts are future parts; they must be installed and authorized separately, not by giving an LLM unrestricted write privileges. The original SE331 project explicitly separates these workflows.

## 5. Multi-user deployment cautions

- Each visitor's Supabase OAuth token and selected database are encrypted into their own HttpOnly cookie. No Supabase project is shared between visitors.
- This does **not** yet supply production-grade organization RBAC, centralized token revocation, per-user durable reporting history, robust distributed abuse/rate limiting, or a vault. A public multi-tenant SaaS requires these additions.
- The Supabase OAuth app must be correctly configured and published to third parties; otherwise only your organization/test users may be able to authorize it.
- AI provider requests share the Vercel app's key and quotas across users. Test load and enable billing caps or stronger user-specific limits before wide release.
- OAuth session tokens are refreshed server-side when necessary; users may need to reconnect when they revoke access. Disconnect clears QueryPilot's encrypted session.
- SQL is executed only through the read-only endpoint or an explicit read-only PostgreSQL transaction. For the manual path, use database-level SELECT grants as a second independent safety boundary.
- The current system supports Supabase PostgreSQL datasets; uploading arbitrary files is not a data ingestion feature yet. Import CSVs into a Supabase project before connecting.

## 6. Verification

GitHub Actions runs a TypeScript type check and a Next.js production build on each push. Actual model responses, OAuth consent and live Supabase queries can be integration-tested only when you supply your own OAuth app/key and project.


## Troubleshooting: ranked product prices and SQL execution errors

If a question such as "Top 5 highest price products?" fails:

1. Confirm that the OAuth app has Projects: Read and Database: Read.
2. QueryPilot now samples numeric-looking text columns (without sending product names or personal records to the AI). Formatted prices such as ₹1,39,900 require numeric normalization before sorting.
3. When Supabase rejects a repairable generated query, QueryPilot attempts one corrected SQL query automatically. The execution animation shows this retry.
4. Errors are classified into permissions, numeric-format problems, or other rejected SQL when possible, without exposing raw database error contents.
5. Supabase's read-only Management API remains beta. A manual read-only PostgreSQL connection is still available for unsupported projects.

Illustrative SQL for a table with product_name and actual_price stored as text:

~~~sql
SELECT product_name, actual_price,
       NULLIF(regexp_replace(actual_price, '[^0-9.]', '', 'g'), '')::numeric AS numeric_price
FROM public.sales_data
WHERE NULLIF(regexp_replace(actual_price, '[^0-9.]', '', 'g'), '') IS NOT NULL
ORDER BY numeric_price DESC
LIMIT 5;
~~~

This is a demonstration query for that dataset; QueryPilot does not hardcode the sales_data table. Schema discovery and SQL planning remain dynamic for other users' Supabase projects. The app never modifies database column types or writes to repair price formatting.

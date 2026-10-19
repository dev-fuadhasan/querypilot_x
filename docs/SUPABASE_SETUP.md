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
6. After authorization, the user selects a project, even when there is only one available. QueryPilot verifies read-only database access before opening the dashboard.
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


## Project selection and dashboard switching

OAuth authorization grants QueryPilot X access to the set of Supabase projects allowed by the consenting user. **It does not automatically activate any specific database.** After returning from Supabase, the first screen lists the user's authorized projects. The user selects one and clicks **Continue to dashboard**.

On later page reloads, QueryPilot restores the selected project from the encrypted session (until the session expires, is revoked or the user disconnects). Merely having an authorized project list does not force another selection screen.

Inside the dashboard, click the **current project name with its dropdown arrow** to show your other authorized projects. Select a project to verify its read-only database access. Only after successful verification does the active session change; the prior project's chat, SQL output and visualizations are cleared. If verification fails, the previous active project stays selected and no data is mixed. New project selection does **not** require repeating Supabase consent while the OAuth authorization remains valid.

Manual connection remains an advanced fallback for accounts where the Supabase read-only Management API is unavailable.


## Dataset-aware clarification (instead of empty SQL results)

QueryPilot X checks **explicit exact numeric filters** such as "products rating 5.3" against an authorized project's real column values before generating the main SQL. It discovers tables and column types dynamically, converts numeric-looking text values for validation, and checks exact-match counts plus available minimum/maximum values. If there are no exact matches, it runs a read-only band count and offers clickable **data-backed ranges**. A selected option replaces the impossible exact value; it does not keep applying the old filter.

The first version covers explicit numeric equality wording (rating, price, score and related metric columns). It does not promise to prevalidate every natural-language filter or every kind of date/category value yet. Database sampling and checks remain SELECT-only. If a probe itself fails, the app should report the error rather than invent available ranges.

On every new question, the UI clears the prior analysis and shows the live query stages. Aborted or older requests are guarded against overwriting later responses. SQL is word-wrapped with no nested scrolling inside the code preview. Very long SQL or reports can still require scrolling the **main result pane** on a small screen, where content cannot physically fit at once.


## Visualization-first dashboard (no AI analysis report)

The **AI analysis report** card is deliberately removed from the workspace. The database query results and the **executed, SELECT-only SQL** remain visible as independent cards, with wrapped code and no nested SQL scrollbar.

Chart selection is now determined from the user's explicit request after SQL has completed. The UI supports **line, vertical column, horizontal bar, pie, donut, area, scatter, radar, heatmap, KPI cards, stacked columns and combination charts**. A prompt can request multiple compatible chart types in one dashboard. If requested dimensions or numeric measures are not present, QueryPilot shows an explanatory message rather than substituting an unrelated chart.

The AI continues generating safe SQL based on the connected database schema, but visualization selection uses a deterministic, schema/result-aware layer. This also eliminates a second AI narrative generation call, improving latency and reducing exposure of returned rows to external model providers.

When QueryPilot asks the user to select from AI-proposed or dataset-validated alternatives, **both the chat and the left workspace** provide a text field for a custom option. Custom clarification is treated as the newer, overriding instruction; the original question is retained only for context, preventing an invalid previous exact-number filter from being reapplied during the data check.

## Project-aware verified questions and chart-only requests

The dashboard includes a read-only GET /api/discovery endpoint. After connecting or switching projects, it discovers public-schema tables and samples up to 100 rows from up to three tables, selecting recognized non-sensitive category, metric, and date columns. Starter questions are built from observed fields/values rather than static demonstration questions. Unsupported datasets show no verified starter suggestions instead of fabricated ones.

When the SQL AI needs clarification, the displayed suggestions and custom-input example are drawn from the current project's sampled, observed values. Exact numeric filters are still checked against the full database before claiming a specific value is absent.

A chart-only prompt, for example 'Make a pie and line graph', now runs separate SELECT-only queries against suitable facets in the current project, instead of sending an underspecified natural-language query to an LLM. Charts are stacked vertically, with the executed SQL available per chart. A failed/unsupported chart does not discard other successfully rendered charts. Pie distributions collect smaller categories into an Other slice so that all non-null category counts remain represented.

A line graph uses a date column when available, otherwise an ordered numeric dimension such as rating. The chart title reflects the measured dimension, not an invented date trend. Without an explicit chart choice, the rendering engine prefers chronological lines, bars for long category labels, KPI cards for single-record aggregates and pies for small positive part-to-whole distributions.

Profiles use bounded samples and therefore do not claim to list every distinct value in the full database. Some projects may have unrecognized columns or insufficient measures. The app continues to use the beta Supabase Management API read-only query endpoint for OAuth connections, or a manually authorized read-only PostgreSQL role. Live OAuth and production rendering must still be tested after deployment.


## Robust SQL handling and honest top-entity trends

Generated SQL now has a quote-aware normalization and read-only validation stage. A single trailing semicolon, harmless SQL comments, and optional Markdown code fences are normalized safely. Punctuation and SQL-looking words inside quoted category/product strings no longer count as multiple statements or write commands. Actual multi-statement or write requests remain blocked. A failed model-generated SQL validation may trigger one fresh, guarded repair attempt; an invalid repaired statement is still refused. These changes do not disable the SELECT-only requirement.

QueryPilot also distinguishes snapshot rankings from real historical trends across connected schemas. Top-N metric rankings can use a verified numeric SQL aggregation. For a request such as top five product rating *trend*, the app first checks for a usable dated rating field. If it is absent, it asks the user to choose a current-rating comparison or a nonhistorical distribution. No invented dates, synthetic histories or misleading series are generated. If dated historical observations exist, the app queries ranked entities by period and pivots the returned real rows into multiple line series. Each series must have observed values across more than one period. Ambiguous similarly named metrics (for example discounted price versus actual price) are passed to clarification rather than silently chosen.

Limits: broad or underspecified questions can still need clarification, and some databases have relationships that require more sophisticated joins than the bounded preflight can infer. Production OAuth access, the Supabase beta query endpoint, model rate limits, and schema restrictions can still cause failures. Automated tests and builds do not guarantee every question can be answered correctly.


## Multiple public tables: all-tables or one-table scope

QueryPilot now discovers a catalog of all public tables readable through the connected project, separate from bounded sample-based dataset profiles. The dashboard has a TABLES selector, defaulting to All tables. A user may select one table (for example, titanic_data) to restrict SQL planning and execution, or use All tables for single-table and appropriately related multi-table queries. All scope values are validated server-side against the currently discovered schema. Switching table scope clears prior results, questions, and visualizations to prevent confusing answers from different datasets.

The routing layer can recognize table names and strongly associated field names even when phrasing varies. A bounded, schema-aware direct query handles clear list requests such as the first 55 Titanic survivors, using an actual Survived indicator and the table's own column capitalization; it does not pretend these passengers are ranked by a survival score. Ambiguous requests such as top 5 products without a ranking metric now request a metric such as rating or price, based on columns actually found. Other questions still use the protected AI SQL planner.

Both sales_data and titanic_data were confirmed in the connected test project, with 366 and 891 rows respectively, and both currently have SELECT grants for supabase_read_only_user. These names are test examples only, not schema constants in the application.

The discovery API exposes the catalog even if fewer tables are included in the bounded row-sampling profile. Current implementation is read-only and respects Supabase role permissions. All tables means permission to ask across authorized tables, not license to create an arbitrary join between unrelated data or to access restricted schemas. It cannot guarantee every natural-language question is answerable. The server returns clearer errors when a request names a table excluded by the selection, or when AI planning or SQL execution fails.


## Verified binary-rate comparisons

For questions asking a rate or percentage by category, QueryPilot first attempts a schema-driven read-only analysis rather than immediately relying on generated AI SQL. A likely outcome column is matched against user wording, including minor spelling errors, and validated against actual database values to ensure that its non-null observations are truly binary (0/1). It then selects a grouping column based on category values observed in the authorized project. The result shows group totals, positive outcomes, and correctly computed rates, with an explicit bar chart and executed SQL. Unknown or non-binary measurements are never treated as survival/approval outcomes by assumption. Personal names, addresses, and contact fields are not sampled to infer chart categories.

For example, a Titanic dataset with columns Sex and Survived can answer 'male vs survival rate' or typoed variants without a model-generated SQL query. This is an example of a general pattern that also supports other verified binary metrics, such as approval rate by department. This improvement does not guarantee every arbitrary semantic or multi-table question is inferable. Database permissions and OAuth endpoints remain subject to the connected user's Supabase authorization. Basic supported questions can be submitted even if a general-purpose AI provider is not configured; advanced requests still need an AI provider.

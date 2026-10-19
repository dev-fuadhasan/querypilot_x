import "server-only";
import type { Session, Project } from "./session";
import type { TableInfo, DataResult } from "./database";
import { guardSql } from "./database";

const BASE = "https://api.supabase.com";
const TOKEN = BASE + "/v1/oauth/token";
function basic() {
  const id = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const secret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Supabase OAuth is not configured.");
  return "Basic " + Buffer.from(id + ":" + secret).toString("base64");
}
function validRef(ref: string) {
  if (!/^[a-z0-9-]{8,40}$/.test(ref)) throw new Error("Invalid Supabase project reference.");
  return ref;
}
export function normalizeProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object"))
    .map((v) => ({ id: String(v.ref || v.id || ""), name: String(v.name || "Supabase project").slice(0, 65) }))
    .filter((p) => /^[a-z0-9-]{8,40}$/.test(p.id)).slice(0, 12);
}
export async function exchangeOAuth(code: string, verifier: string, redirectUri: string) {
  const response = await fetch(TOKEN, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(14000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: basic() },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }),
  });
  if (!response.ok) throw new Error("Supabase declined the authorization code. Try connecting again.");
  const value: unknown = await response.json();
  return parseTokens(value);
}
function parseTokens(value: unknown) {
  const token = value as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!token || typeof token.access_token !== "string" || typeof token.refresh_token !== "string")
    throw new Error("Supabase did not return usable authorization tokens.");
  const expiry = Number(token.expires_in);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (Number.isFinite(expiry) && expiry > 0 ? expiry : 3600) * 1000,
  };
}
export async function ensureOAuthSession(session: Session): Promise<{ session: Session; refreshed: boolean }> {
  if (session.mode !== "oauth" || !session.accessToken || !session.refreshToken) throw new Error("Supabase authorization is missing. Reconnect.");
  if (session.expiresAt && Date.now() < session.expiresAt - 90000) return { session, refreshed: false };
  const response = await fetch(TOKEN, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(12000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: basic() },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }),
  });
  if (!response.ok) throw new Error("Supabase authorization expired or was revoked. Reconnect your project.");
  const token = parseTokens(await response.json());
  return { session: { ...session, ...token }, refreshed: true };
}
export async function listProjects(accessToken: string): Promise<Project[]> {
  const response = await fetch(BASE + "/v1/projects", {
    cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!response.ok) throw new Error("Cannot list projects. Enable Projects: Read in the Supabase OAuth app.");
  return normalizeProjects(await response.json());
}
export class SupabaseQueryError extends Error {
  readonly repairable: boolean;
  readonly category: "sql" | "permission" | "connection";
  constructor(message: string, repairable: boolean, category: "sql" | "permission" | "connection") {
    super(message);
    this.name = "SupabaseQueryError";
    this.repairable = repairable;
    this.category = category;
  }
}
function describeFailure(status: number, source: unknown): SupabaseQueryError {
  const payload = source && typeof source === "object" ? source as Record<string, unknown> : {};
  const raw = [payload.message, payload.error, payload.details, payload.hint]
    .filter((item): item is string => typeof item === "string").join(" ").slice(0, 1000);
  // Never echo raw error details: they may include database values or internal identifiers.
  if (/permission denied|insufficient privilege|row.level security|not authorized/i.test(raw) || status === 403) {
    return new SupabaseQueryError("Supabase denied access to this table. Check the OAuth Database: Read scope and the selected project's table permissions.", false, "permission");
  }
  if (/invalid input syntax for type (numeric|integer|double)|could not convert|invalid digit/i.test(raw)) {
    return new SupabaseQueryError("SQL attempted to convert formatted text into a number. QueryPilot will retry using a safer numeric conversion.", true, "sql");
  }
  if (/column .* does not exist|relation .* does not exist|syntax error|operator does not exist|function .* does not exist/i.test(raw)) {
    return new SupabaseQueryError("Supabase rejected a generated SQL expression or identifier. QueryPilot will try a corrected query.", true, "sql");
  }
  return new SupabaseQueryError(
    "Supabase read-only query failed (HTTP " + status + "). QueryPilot will retry if the SQL is repairable; an unavailable beta endpoint or database restrictions may also cause this.",
    status === 400 || status >= 500,
    status === 400 || status >= 500 ? "sql" : "connection"
  );
}

export async function managementReadOnly(session: Session, query: string): Promise<Record<string, unknown>[]> {
  if (!session.projectRef || !session.accessToken || session.mode !== "oauth")
    throw new Error("Select a connected Supabase project.");
  const ref = validRef(session.projectRef);
  const url = BASE + "/v1/projects/" + encodeURIComponent(ref) + "/database/query/read-only";
  const response = await fetch(url, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(24000),
    headers: {
      Authorization: "Bearer " + session.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (response.status === 401) throw new Error("Supabase session expired. Reconnect your project.");
  if (response.status === 403) throw new Error("Supabase denied read-only database access. Enable Database: Read in OAuth app permissions.");
  if (response.status === 404) throw new Error("The Supabase read-only query endpoint is unavailable for this project. Use manual read-only connection.");
  if (response.status === 429) throw new Error("Supabase has temporarily rate-limited queries. Try again shortly.");
  if (!response.ok) {
    // Capture the provider's error category without disclosing raw DB contents in the browser.
    const payload: unknown = await response.json().catch(() => ({}));
    throw describeFailure(response.status, payload);
  }
  const value: unknown = await response.json();
  // Management API versions may return rows as a bare list or inside a result object.
  let rows: unknown = value;
  if (!Array.isArray(rows) && value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (object.error) throw new Error("Supabase reported a database query error.");
    rows = object.result ?? object.data ?? object.rows;
  }
  if (!Array.isArray(rows)) throw new Error("Supabase returned an unexpected query result format.");
  return rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
}
export async function getOAuthSchema(session: Session): Promise<TableInfo[]> {
  const rows = await managementReadOnly(session, `SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns AS c INNER JOIN information_schema.tables AS t ON c.table_schema = t.table_schema AND c.table_name = t.table_name WHERE c.table_schema = 'public' AND t.table_type IN ('BASE TABLE', 'VIEW') ORDER BY c.table_name, c.ordinal_position LIMIT 600`);
  const grouped = new Map<string, { name: string; type: string }[]>();
  for (const row of rows) {
    if (typeof row.table_name !== "string" || typeof row.column_name !== "string" || typeof row.data_type !== "string") continue;
    if (!grouped.has(row.table_name)) grouped.set(row.table_name, []);
    if (grouped.size > 30) break;
    grouped.get(row.table_name)?.push({ name: row.column_name, type: row.data_type });
  }
  return [...grouped].map(([name, columns]) => ({ name, columns }));
}
export async function executeOAuthQuery(session: Session, sql: string): Promise<DataResult> {
  const approved = guardSql(sql);
  // The beta read-only endpoint specifically requires schema-qualified entity references.
  // The planner is prompted to qualify public tables. Invalid SQL fails closed at Supabase.
  const rowsWithLimit = await managementReadOnly(session, "SELECT * FROM (" + approved + ") AS querypilot_result LIMIT 201");
  const rows = rowsWithLimit.slice(0, 200);
  const keys = rows.length ? Object.keys(rows[0]).slice(0, 80) : [];
  const columns = keys.map((name) => {
    const observed = rows.find((row) => row[name] !== null && row[name] !== undefined)?.[name];
    const type: "number" | "date" | "text" = typeof observed === "number" || (typeof observed === "string" && /^-?\d+(?:\.\d+)?$/.test(observed))
      ? "number" : typeof observed === "string" && /^\d{4}-\d{2}-\d{2}/.test(observed) ? "date" : "text";
    return { name, type };
  });
  return { columns, rows, truncated: rowsWithLimit.length > 200 };
}

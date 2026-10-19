import "server-only";
import { Client } from "pg";
import { normalizeAndGuardSql } from "./sql-guard";

export type ColumnInfo = { name: string; type: string; examples?: string[] };
export type TableInfo = { name: string; columns: ColumnInfo[] };
export type DataResult = {
  columns: { name: string; type: "number" | "date" | "text" }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
};

export function validateSupabaseUri(raw: string, requestedRef?: string): { url: string; ref: string } {
  if (raw.length > 1500) throw new Error("Connection string is too long.");
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("Enter a valid PostgreSQL connection string."); }
  if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error("A PostgreSQL connection string is required.");
  if (!url.username || !url.password || !url.hostname) throw new Error("The database username and password are required.");
  if (url.port && !["5432", "6543"].includes(url.port)) throw new Error("Only standard Supabase PostgreSQL ports are supported.");
  if (url.pathname !== "/postgres") throw new Error("Use the Supabase 'postgres' database.");
  const mode = url.searchParams.get("sslmode");
  if (mode && !["require", "verify-full", "verify-ca"].includes(mode)) throw new Error("SSL must be enabled.");
  if ([...url.searchParams.keys()].some((key) => key !== "sslmode")) throw new Error("Remove extra connection string options.");
  let ref = "";
  const direct = /^db\.([a-z0-9-]{10,40})\.supabase\.co$/.exec(url.hostname.toLowerCase());
  if (direct) {
    ref = direct[1];
  } else if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname.toLowerCase())) {
    const match = /\.([a-z0-9-]{10,40})$/.exec(decodeURIComponent(url.username));
    if (!match) throw new Error("For pooler connections use a username ending in .PROJECT_REF.");
    ref = match[1];
  } else {
    throw new Error("Only official Supabase database and pooler hosts can be connected.");
  }
  if (requestedRef && ref !== requestedRef) throw new Error("The connection string does not match the selected Supabase project.");
  return { url: raw.trim(), ref };
}
function createClient(url: string) {
  return new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 6500,
    query_timeout: 12000,
    application_name: "querypilot_x",
  });
}
async function withReadOnly<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = createClient(url);
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '9000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    const result = await run(client);
    await client.query("ROLLBACK");
    return result;
  } finally {
    await client.end().catch(() => undefined);
  }
}
export async function getSchema(url: string): Promise<TableInfo[]> {
  return withReadOnly(url, async (client) => {
    const result = await client.query<{ table_name: string; column_name: string; data_type: string }>(
      "SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c JOIN information_schema.tables t ON c.table_schema = t.table_schema AND c.table_name = t.table_name WHERE c.table_schema = 'public' AND t.table_type IN ('BASE TABLE', 'VIEW') ORDER BY c.table_name, c.ordinal_position LIMIT 900"
    );
    const tables = new Map<string, ColumnInfo[]>();
    for (const item of result.rows) {
      if (!tables.has(item.table_name)) tables.set(item.table_name, []);
      if (tables.size > 40) break;
      tables.get(item.table_name)?.push({ name: item.column_name, type: item.data_type });
    }
    return [...tables].map(([name, columns]) => ({ name, columns }));
  });
}
export function guardSql(text: string): string {
  return normalizeAndGuardSql(text);
}
export async function executeQuery(url: string, sql: string): Promise<DataResult> {
  const approved = guardSql(sql);
  return withReadOnly(url, async (client) => {
    // An additional LIMIT protects both the UI and the model from huge outputs.
    const result = await client.query("SELECT * FROM (" + approved + ") AS querypilot_result LIMIT 201");
    const rows = result.rows.slice(0, 200) as Record<string, unknown>[];
    const columns = result.fields.map((field) => ({
      name: field.name,
      type: ([20, 21, 23, 700, 701, 1700].includes(field.dataTypeID)
        ? "number" : [1082, 1114, 1184].includes(field.dataTypeID) ? "date" : "text") as "number" | "date" | "text",
    }));
    return { columns, rows, truncated: result.rows.length > 200 };
  });
}

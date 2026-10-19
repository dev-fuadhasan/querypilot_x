import "server-only";
import type { TableInfo } from "./database";

const NUMERIC_LOOKING_COLUMN = /(?:^|_)(price|cost|amount|total|discount|rate|rating|count|qty|quantity|margin|revenue|sales|tax|fee)(?:_|$)/i;
const TEXT_TYPES = new Set(["text", "character varying", "character", "varchar", "citext"]);
const SENSITIVE_NAME = /password|token|secret|key|personal|email|phone|address|contact|person|user|customer|employee|salary|bank|card|ssn|account|dob|birth|name/i;
const MAX_TABLES = 5;
const MAX_COLUMNS_PER_TABLE = 5;
function quoteIdentifier(value: string) {
  return '"' + value.replace(/"/g, '""') + '"';
}
function cleanSample(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length > 26 || !/\d/.test(text)) return null;
  // Numeric-looking examples only: no arbitrary text or names sent to LLM.
  if (!/^[₹$€£¥₩₽₺₦฿\d.,%+\-()\s]+$/.test(text)) return null;
  return text;
}
export async function enrichSchemaWithExamples(
  schema: TableInfo[],
  execute: (sql: string) => Promise<Record<string, unknown>[]>
): Promise<TableInfo[]> {
  const enriched: TableInfo[] = schema.map(table => ({ ...table, columns: table.columns.map(col => ({ ...col })) }));
  let tablesSampled = 0;
  for (const table of enriched) {
    const targets = table.columns.filter(column =>
      TEXT_TYPES.has(column.type.toLowerCase()) &&
      NUMERIC_LOOKING_COLUMN.test(column.name) &&
      !SENSITIVE_NAME.test(column.name)
    ).slice(0, MAX_COLUMNS_PER_TABLE);
    if (!targets.length) continue;
    if (tablesSampled >= MAX_TABLES) break;
    tablesSampled++;
    // Only use server-derived table and column identifiers. Query output is limited to 5 rows,
    // and we transmit only short numeric-formatted examples, never arbitrary row values.
    const sql = "SELECT " + targets.map(column => quoteIdentifier(column.name)).join(", ") +
      " FROM public." + quoteIdentifier(table.name) + " LIMIT 5";
    try {
      const rows = await execute(sql);
      for (const column of targets) {
        const samples = [...new Set(rows.map(row => cleanSample(row[column.name])).filter((v): v is string => Boolean(v)))].slice(0, 3);
        if (samples.length) column.examples = samples;
      }
    } catch {
      // Schema inspection still works for restricted projects even when sampling is denied.
    }
  }
  return enriched;
}

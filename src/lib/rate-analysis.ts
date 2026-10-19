import type { TableInfo } from "./database";

export type RatePlan = {
  sql: string;
  table: string;
  group: string;
  outcome: string;
  title: string;
  xKey: "group_name";
  yKeys: ["rate_pct"];
};
type Row = Record<string, unknown>;
type Reader = (sql: string) => Promise<Row[]>;

// Match words with a small edit allowance so that common spelling mistakes in
// business questions do not turn into invented database column names.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = next;
  }
  return prev[b.length];
}
const ALIASES: Record<string, string[]> = {
  survived: ["survived", "survive", "survival", "survivor", "survivors"],
  approved: ["approved", "approve", "approval"],
  passed: ["passed", "pass", "passing"],
  converted: ["converted", "convert", "conversion"],
  retained: ["retained", "retain", "retention"],
  churned: ["churn", "churned", "attrition"],
  completed: ["completed", "complete", "completion"],
  recovered: ["recovered", "recover", "recovery"],
  admitted: ["admitted", "admission", "admit"],
};
function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function hasWordNear(question: string, candidates: string[]): boolean {
  return words(question).some(token => candidates.some(candidate => token === candidate ||
    (token.length >= 6 && candidate.length >= 6 && editDistance(token, candidate) <= 2)));
}
function positiveOutcome(question: string, colName: string): boolean {
  const field = words(colName);
  if (field.some(token => hasWordNear(question, [token]))) return true;
  for (const [name, labels] of Object.entries(ALIASES)) {
    if (field.includes(name) && hasWordNear(question, labels)) return true;
  }
  return false;
}
function safeIdentifier(value: string): string { return '"' + value.replace(/"/g, '""') + '"'; }
function isBinaryCandidateType(type: string): boolean {
  return /^(?:smallint|integer|bigint|numeric|decimal|double precision|real|boolean)$/i.test(type);
}
function textCategory(type: string): boolean { return /text|varchar|character|citext/i.test(type); }
function sensitive(col: string): boolean {
  return /password|secret|token|email|phone|address|(?:^|_)name(?:_|$)|first_?name|last_?name|full_?name|account|ssn|passport|birth|ip_address/i.test(col);
}
function groupAffinity(question: string, column: string): number {
  const normalized = column.replace(/_/g, " ");
  const tokens = words(normalized);
  if (tokens.some(t => hasWordNear(question, [t]))) return 8;
  if (/^(?:sex|gender)$/i.test(column) && hasWordNear(question, ["male", "female", "men", "women", "gender"])) return 8;
  if (/^(?:region|city|location|department|category|segment|class|pclass)$/i.test(column)
    && hasWordNear(question, [normalized, "group", "groups", "breakdown"])) return 3;
  return 0;
}
function outcomeLabel(name: string): string {
  if (/surviv/i.test(name)) return "Survival";
  if (/approv/i.test(name)) return "Approval";
  if (/pass/i.test(name)) return "Pass";
  if (/convert/i.test(name)) return "Conversion";
  if (/retain/i.test(name)) return "Retention";
  if (/churn/i.test(name)) return "Churn";
  return name.replace(/_/g, " ");
}
function asksForRate(question: string): boolean {
  return /\b(rate|rates|percentage|percent|proportion|likelihood|probability|ratio)\b/i.test(question);
}
/**
 * Builds SQL from read-only, server-discovered identifiers only. The outcome
 * must match the user's terminology and must be observed to contain only 0/1.
 * Category values are read only to choose the dimension, never included in SQL.
 * Returns null when the schema does not support a verified interpretation.
 */
export async function planVerifiedBinaryRate(
  question: string,
  schema: TableInfo[],
  readRows: Reader
): Promise<RatePlan | null> {
  if (!asksForRate(question)) return null;
  const possible = schema.flatMap(table => table.columns
    .filter(col => isBinaryCandidateType(col.type) && positiveOutcome(question, col.name))
    .map(col => ({ table, outcome: col })));
  if (possible.length !== 1) return null;
  const { table, outcome } = possible[0];
  const tableId = "public." + safeIdentifier(table.name);
  const outcomeId = safeIdentifier(outcome.name);
  const probe = await readRows("SELECT " +
    "COUNT(*) FILTER (WHERE " + outcomeId + " IS NOT NULL)::integer AS present, " +
    "COUNT(*) FILTER (WHERE " + outcomeId + " IS NOT NULL AND " + outcomeId + " NOT IN (0, 1))::integer AS invalid " +
    "FROM " + tableId);
  if (!probe.length || Number(probe[0].present) <= 0 || Number(probe[0].invalid) !== 0) return null;

  const candidates = table.columns.filter(c =>
    c.name !== outcome.name && textCategory(c.type) && !sensitive(c.name));
  if (!candidates.length) return null;
  let selected: { column: string; score: number; values: string[] } | null = null;
  for (const col of candidates.slice(0, 10)) {
    const score = groupAffinity(question, col.name);
    // Only profile plausible categories when the question asks for a comparison.
    if (score === 0 && !/\b(by|vs|versus|compare|comparison|between|among|across|group)\b/i.test(question)) continue;
    const values = await readRows("SELECT DISTINCT " + safeIdentifier(col.name) +
      "::text AS value FROM " + tableId + " WHERE " + safeIdentifier(col.name) +
      " IS NOT NULL LIMIT 16");
    const options = values.map(r => r.value).filter((v): v is string =>
      typeof v === "string" && v.length > 0 && v.length < 80);
    if (options.length < 2 || options.length > 12) continue;
    const mentioned = options.some(value => words(value).some(token =>
      token.length >= 3 && hasWordNear(question, [token])));
    const finalScore = score + (mentioned ? 10 : 0);
    if (finalScore <= 0) continue;
    if (selected && finalScore <= selected.score) continue;
    selected = { column: col.name, score: finalScore, values: options };
  }
  if (!selected) return null;
  const groupId = safeIdentifier(selected.column);
  const sql = "SELECT " + groupId + "::text AS group_name, " +
    "COUNT(*)::integer AS total, " +
    "COUNT(*) FILTER (WHERE " + outcomeId + " = 1)::integer AS positive, " +
    "ROUND(100.0 * COUNT(*) FILTER (WHERE " + outcomeId +
    " = 1) / NULLIF(COUNT(*), 0), 2) AS rate_pct " +
    "FROM " + tableId + " WHERE " + groupId + " IS NOT NULL AND " +
    outcomeId + " IS NOT NULL GROUP BY " + groupId +
    " ORDER BY rate_pct DESC, group_name ASC LIMIT 30";
  return {
    sql, table: table.name, group: selected.column, outcome: outcome.name,
    title: outcomeLabel(outcome.name) + " rate by " + selected.column + " (%)",
    xKey: "group_name", yKeys: ["rate_pct"]
  };
}

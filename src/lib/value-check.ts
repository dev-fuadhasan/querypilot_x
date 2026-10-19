import type { TableInfo } from "./database";

export type NumericEquality = { table: string; column: string; value: number };
export type DataClarification = { question: string; options: string[]; optionQueries: string[] };
const METRIC_HINT = /rating|score|price|cost|amount|discount|quantity|qty|count|percentage|percent|revenue|total|age|duration|weight|height|distance|temperature|value/i;
const NUMERIC_TYPES = /^(?:integer|bigint|smallint|numeric|decimal|double precision|real|text|character varying|character|varchar)$/i;
function quoteIdentifier(value: string) { return '"' + value.replace(/"/g, '""') + '"'; }
function formatNumber(value: number): string { return String(Number(value.toFixed(6))); }
function safeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function escapeRx(value: string): string { return value.split("").map(c => "\\^$.*+?()[]{}|".includes(c) ? "\\" + c : c).join(""); }
export function findExactNumericFilter(question: string, schema: TableInfo[]): NumericEquality | null {
  if (/\b(?:between|at least|at most|more than|less than|greater than|higher than|lower than|above|below|over|under|minimum|maximum)\b/i.test(question)) return null;
  const candidates: { matched: NumericEquality; weight: number }[] = [];
  for (const table of schema) for (const col of table.columns) {
    if (!NUMERIC_TYPES.test(col.type) || !METRIC_HINT.test(col.name)) continue;
    const words = [col.name.replace(/_/g, " "), col.name];
    if (/(?:^|_)rating(?:_|$)/i.test(col.name)) words.push("rated", "stars?", "star rating");
    for (const word of words) {
      const expression = new RegExp("\\b" + escapeRx(word).replace("stars\\?", "stars?") +
        "\\s*(?:is\\s+|of\\s+|equals?\\s+|equal\\s+to\\s+|exactly\\s+|at\\s+)?[:=]?\\s*(-?\\d+(?:\\.\\d+)?)\\b", "i");
      const found = question.match(expression);
      if (!found) continue;
      const value = Number(found[1]);
      if (!Number.isFinite(value) || Math.abs(value) > 1000000000) continue;
      const root = table.name.replace(/(?:_data|_table|_records|_items)$/i, "").toLowerCase();
      const named = question.toLowerCase().includes(root) ? 2 : 0;
      candidates.push({ matched: { table: table.name, column: col.name, value }, weight: named + word.length / 100 });
    }
  }
  candidates.sort((a, b) => b.weight - a.weight);
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].matched.table !== candidates[1].matched.table && Math.abs(candidates[0].weight - candidates[1].weight) < .1) return null;
  return candidates[0].matched;
}
export function numericValueExpression(column: string): string {
  const cleaned = "NULLIF(regexp_replace(" + quoteIdentifier(column) + "::text, '[^0-9.]', '', 'g'), '')";
  return "CASE WHEN " + cleaned + " ~ '^[0-9]+([.][0-9]+)?$' THEN " + cleaned + "::numeric ELSE NULL END";
}
function valuesCte(check: NumericEquality): string {
  return "WITH numeric_values AS (SELECT " + numericValueExpression(check.column) +
    " AS value FROM public." + quoteIdentifier(check.table) + ") ";
}
export function numericStatsSql(check: NumericEquality): string {
  return valuesCte(check) + "SELECT COUNT(*) FILTER (WHERE value = " + formatNumber(check.value) + ") AS exact_matches, " +
    "MIN(value) AS min_value, MAX(value) AS max_value, COUNT(value) AS valid_count FROM numeric_values";
}
export function rangeDefinitions(min: number, max: number, target: number): { min: number; max: number; highInclusive: boolean }[] {
  if (max < min || !Number.isFinite(target)) return [];
  const span = max - min;
  if (span === 0) return [{ min, max, highInclusive: true }];
  const step = span <= 5 ? 0.5 : span <= 10 ? 1 : Math.max(1, Number((span / 5).toPrecision(2)));
  let upper = target > max ? max : target < min ? min + step : Math.ceil(target / step) * step;
  upper = Math.min(max, Math.max(min + step, upper));
  const bands = [];
  for (let i = 0; i < 3 && upper > min; i++) {
    const lower = Math.max(min, Number((upper - step).toFixed(6)));
    bands.push({ min: lower, max: upper, highInclusive: i === 0 });
    upper = lower;
  }
  return bands;
}
export function rangeCountsSql(check: NumericEquality, bands: ReturnType<typeof rangeDefinitions>): string {
  const columns = bands.map((band, i) => "COUNT(*) FILTER (WHERE value >= " + formatNumber(band.min) +
    " AND value " + (band.highInclusive ? "<= " : "< ") + formatNumber(band.max) + ") AS count_" + i);
  return valuesCte(check) + "SELECT " + columns.join(", ") + " FROM numeric_values";
}
export function buildMissingValueClarification(
  question: string,
  filter: NumericEquality,
  stats: Record<string, unknown>,
  bands: ReturnType<typeof rangeDefinitions>,
  counts: Record<string, unknown>
): DataClarification | null {
  if (safeNumber(stats.exact_matches) !== 0) return null;
  const min = safeNumber(stats.min_value);
  const max = safeNumber(stats.max_value);
  const count = safeNumber(stats.valid_count);
  if (min === null || max === null || count === null || count === 0) return null;
  const options: string[] = [];
  const optionQueries: string[] = [];
  for (const [index, band] of bands.entries()) {
    const matches = safeNumber(counts["count_" + index]) || 0;
    if (matches <= 0) continue;
    const comparator = band.highInclusive ? "<=" : "<";
    options.push(formatNumber(band.min) + " to " + (band.highInclusive ? "" : "below ") + formatNumber(band.max) +
      " (" + matches + " matching records)");
    const conditions = filter.column + " >= " + formatNumber(band.min) + " AND " + filter.column + " " +
      comparator + " " + formatNumber(band.max);
    const numberPattern = new RegExp("(?<![\\d.])" + escapeRx(formatNumber(filter.value)) + "(?![\\d.])");
    const revisedQuestion = question.replace(numberPattern, "(" + conditions + ")");
    optionQueries.push(revisedQuestion + ". Use this numeric " + filter.column +
      " range from table public." + filter.table + ". Do not apply a previous exact numeric value.");
  }
  options.push("All available " + filter.column.replace(/_/g, " ") + " values (" + count + " records)");
  optionQueries.push("Show records from public." + filter.table + " with any non-null numeric " +
    filter.column + " value. Do not apply an exact " + filter.column + " filter.");
  return {
    question: "No records have " + filter.column.replace(/_/g, " ") + " exactly " + formatNumber(filter.value) +
      ". Observed values range from " + formatNumber(min) + " to " + formatNumber(max) +
      ". Choose an available range:",
    options: options.slice(0, 4),
    optionQueries: optionQueries.slice(0, 4),
  };
}

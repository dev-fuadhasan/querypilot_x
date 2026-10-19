import type { TableInfo } from "./database";
import type { ChartKind } from "./charts";


export type CategoryFacet = { column: string; values: string[] };
export type NumericFacet = { column: string; observed: number[] };
export type TableProfile = {
  name: string;
  categories: CategoryFacet[];
  numeric: NumericFacet[];
  dates: string[];
  sampleSize: number;
};
export type ProjectProfile = { tables: TableProfile[]; starters: string[] };
export type VerifiedOption = { label: string; query: string };
export type ChartQuery = { kind: ChartKind; title: string; sql: string; xKey: string; yKeys: string[] };

const CATEGORY = /(?:^|_)(category|status|region|state|country|segment|type|department|channel|group|class|product_category|priority|level)(?:_|$)/i;
const NUMERIC = /(?:^|_)(price|cost|amount|quantity|qty|rating|score|count|revenue|sales|total|percentage|discount|age|value|profit|duration|temperature)(?:_|$)/i;
const PRIVATE = /(?:password|token|secret|key|email|phone|address|user|person|customer|employee|patient|owner|id\b|name\b|birth|ssn|bank|card|auth|ip_)/i;
const DATE = /(?:^|_)(date|datetime|timestamp|created_at|updated_at|month|year)(?:_|$)/i;
const DATE_TYPE = /date|timestamp/i;
const NUM_TYPE = /integer|bigint|smallint|numeric|decimal|double precision|real|float/i;
const MAX_TABLES = 3;
export function quoteColumn(name: string): string { return '"' + name.replace(/"/g, '""') + '"'; }
function numericValueExpression(column: string): string {
  const cleaned = "NULLIF(regexp_replace(" + quoteColumn(column) + "::text, '[^0-9.-]', '', 'g'), '')";
  return "CASE WHEN " + cleaned + " ~ '^[-]?[0-9]+([.][0-9]+)?$' THEN " + cleaned + "::numeric ELSE NULL END";
}
function cleanedCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length < 1 || v.length > 110 || /[\n\r\t<>@]/.test(v)) return null;
  return v;
}
function parsedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.length > 30) return null;
  if (!/^[\s₹$€£¥\d,%.+-]+$/.test(value)) return null;
  const normalized = value.replace(/[^0-9.-]/g, "");
  const number = Number(normalized);
  return /^-?\d+(?:\.\d+)?$/.test(normalized) && Number.isFinite(number) ? number : null;
}
export function inspectColumns(table: TableInfo) {
  const cols = table.columns.filter(c => !PRIVATE.test(c.name));
  const categories = cols.filter(c => CATEGORY.test(c.name) && /text|character|varchar|citext/i.test(c.type)).slice(0, 2);
  const numeric = cols.filter(c => NUMERIC.test(c.name) && (/text|character|varchar|citext/i.test(c.type) || NUM_TYPE.test(c.type))).slice(0, 3);
  const dates = cols.filter(c => DATE_TYPE.test(c.type) || (DATE.test(c.name) && /text|character|varchar/i.test(c.type))).slice(0, 1);
  return { categories, numeric, dates };
}
/** Only sampled, non-sensitive, schema-approved columns are read. All suggested values were observed. */
export async function inspectProject(
  schema: TableInfo[],
  execute: (sql: string) => Promise<Record<string, unknown>[]>
): Promise<ProjectProfile> {
  const tables: TableProfile[] = [];
  for (const table of schema.slice(0, 12)) {
    if (tables.length >= MAX_TABLES) break;
    const cols = inspectColumns(table);
    const names = [...new Set([...cols.categories, ...cols.numeric, ...cols.dates].map(c => c.name))];
    if (!names.length) continue;
    try {
      const sql = "SELECT " + names.map(quoteColumn).join(", ") + " FROM public." + quoteColumn(table.name) + " LIMIT 100";
      const rows = await execute(sql);
      if (!rows.length) continue;
      const categories = cols.categories.map(col => ({
        column: col.name,
        values: [...new Set(rows.map(row => cleanedCategory(row[col.name])).filter((v): v is string => v !== null))].slice(0, 8)
      })).filter(col => col.values.length > 0);
      const numeric = cols.numeric.map(col => ({
        column: col.name,
        observed: [...new Set(rows.map(row => parsedNumber(row[col.name])).filter((v): v is number => v !== null))].slice(0, 15)
      })).filter(col => col.observed.length > 0);
      const dates = cols.dates.filter(col => DATE_TYPE.test(col.type) && rows.some(row => {
        const v = row[col.name];
        return typeof v === "string" && v.length < 40 && !Number.isNaN(Date.parse(v));
      })).map(col => col.name);
      tables.push({ name: table.name, categories, numeric, dates, sampleSize: rows.length });
    } catch {
      // Profiles are optional. An inaccessible table never becomes a suggested option.
    }
  }
  return { tables, starters: starterQuestions(tables) };
}
export function starterQuestions(tables: TableProfile[]): string[] {
  const questions: string[] = [];
  for (const table of tables) {
    const where = "in " + table.name;
    const category = table.categories.find(f => f.values.length > 1);
    const metric = table.numeric[0];
    const date = table.dates[0];
    if (category) {
      questions.push("Show a pie chart of " + category.column.replace(/_/g, " ") + " distribution " + where);
      questions.push("Compare record counts by " + category.column.replace(/_/g, " ") + " " + where + " as a bar chart");
    }
    if (date) questions.push("Make a line graph of record counts over " + date + " " + where);
    else if (metric) questions.push("Make a line graph of record counts by " + metric.column + " " + where);
    if (metric && category) {
      questions.push("Compare average " + metric.column + " by " + category.column + " " + where);
    }
  }
  return [...new Set(questions)].slice(0, 5);
}
function label(v: string): string {
  return v.length > 49 ? v.slice(0, 46) + "…" : v;
}
export function verifiedChoices(profile: ProjectProfile, question: string, max = 4): VerifiedOption[] {
  const choices: { option: VerifiedOption; score: number }[] = [];
  const words = question.toLowerCase();
  for (const table of profile.tables) {
    const tableScore = words.includes(table.name.toLowerCase()) ? 3 : 0;
    for (const facet of table.numeric) {
      const score = tableScore + (words.includes(facet.column.replace(/_/g, " ")) ? 5 : 0)
        + (/rating|score|price|amount|cost|revenue|value/i.test(words) ? 1 : 0);
      const values = [...facet.observed].sort((a,b)=>a-b);
      const observed = values[Math.floor(values.length / 2)];
      if (observed !== undefined) {
        choices.push({ score:score+2, option: {
          label: table.name + " · " + facet.column + " = " + observed + " (observed)",
          query: "Show records in public." + table.name + " where numeric " + facet.column + " equals " + observed,
        }});
      }
      if (values.length >= 2) {
        choices.push({ score, option: {
          label: table.name + " · " + facet.column + " value distribution",
          query: "Make a line graph of record counts ordered by numeric " + facet.column + " in public." + table.name,
        }});
      }
    }
    for (const facet of table.categories) {
      if (facet.values.length < 2) continue;
      const score = tableScore + (words.includes(facet.column.replace(/_/g, " ")) ? 5 : 0)
        + (/pie|category|type|status|segment|region|distribution/i.test(words) ? 2 : 0);
      choices.push({ score, option: {
        label: table.name + " · " + facet.column + " distribution",
        query: "Create a pie chart of record counts by " + facet.column + " in public." + table.name,
      }});
      const sample = facet.values[0];
      choices.push({ score:score-1, option: {
        label: table.name + " · " + facet.column + " = " + label(sample) + " (observed)",
        query: "Show records from public." + table.name + " where " + facet.column + " equals " + JSON.stringify(sample),
      }});
    }
    if (table.dates.length) choices.push({ score:tableScore+1, option: {
      label: table.name + " · Monthly trend by " + table.dates[0],
      query: "Create a line graph of record counts over " + table.dates[0] + " in public." + table.name,
    }});
  }
  return [...new Map(choices.sort((a,b)=>b.score-a.score).map(c=>[c.option.label,c.option])).values()].slice(0, max);
}
export function isChartOnlyRequest(question: string): boolean {
  const normalized = question.toLowerCase()
    .replace(/\b(?:pie|line|column|bar|donut|doughnut|area|scatter|radar|heatmap|heat map|kpi|card|cards|graph|graphs|chart|charts|plot|plots|dashboard|make|create|generate|draw|show|me|a|an|the|and|or|also|multiple|some|visualizations|visualization|please|with|different|two|three|for|my|current|connected|project|dataset|database|data)\b/gi,"")
    .replace(/[,\s.!?&-]+/g,"").trim();
  return normalized === "";
}
function tableForChart(tables: TableProfile[], kind: ChartKind): TableProfile | null {
  if (["pie", "donut", "radar"].includes(kind)) return tables.find(t => t.categories.some(f => f.values.length > 1)) || null;
  if (["line", "area"].includes(kind)) return tables.find(t => t.dates.length || t.numeric.some(n=>n.observed.length > 1)) || null;
  return tables.find(t => t.categories.length || t.numeric.length) || null;
}
export function chartQueryFor(kind: ChartKind, profile: ProjectProfile): ChartQuery | null {
  const table = tableForChart(profile.tables, kind);
  if (!table) return null;
  const from = " FROM public." + quoteColumn(table.name);
  const cat = table.categories.find(f => f.values.length > 1);
  const numeric = table.numeric.find(n => n.observed.length > 1);
  if (["combo", "stacked-column"].includes(kind)) {
    const metrics = table.numeric.filter(f => f.observed.length > 1).slice(0, 2);
    if (!cat || metrics.length !== 2) return null;
    const dimension = quoteColumn(cat.column);
    const sql = "SELECT " + dimension + "::text AS dimension, " +
      "AVG(" + numericValueExpression(metrics[0].column) + ")::numeric AS metric_1, " +
      "AVG(" + numericValueExpression(metrics[1].column) + ")::numeric AS metric_2" +
      from + " WHERE " + dimension + " IS NOT NULL GROUP BY 1 ORDER BY 1 LIMIT 25";
    return {kind, title: table.name + " · " + metrics[0].column + " and " + metrics[1].column +
      " by " + cat.column, sql, xKey: "dimension", yKeys: ["metric_1", "metric_2"]};
  }
  if (["pie", "donut", "radar", "bar", "column", "heatmap"].includes(kind) && cat) {
    const dimension = quoteColumn(cat.column);
    const tableRef = "public." + quoteColumn(table.name);
    const grouped = (kind === "pie" || kind === "donut");
    // Include an "Other" slice: dropping small categories would misrepresent parts of the total.
    const expression = grouped
      ? "CASE WHEN " + dimension + " IN (SELECT " + dimension + " FROM " + tableRef +
        " WHERE " + dimension + " IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 5) " +
        "THEN " + dimension + "::text ELSE 'Other' END"
      : dimension + "::text";
    const sql = "SELECT " + expression + " AS dimension, COUNT(*)::integer AS records" + from +
      " WHERE " + dimension + " IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT " + (grouped ? "6" : "25");
    return { kind, title: table.name + " · " + cat.column + " distribution", sql, xKey:"dimension", yKeys:["records"] };
  }
  if (["line", "area"].includes(kind) && table.dates.length) {
    const d = quoteColumn(table.dates[0]);
    const sql = "SELECT DATE_TRUNC('month', " + d + "::timestamp)::date::text AS dimension, COUNT(*)::integer AS records" +
      from + " WHERE " + d + " IS NOT NULL GROUP BY 1 ORDER BY 1 ASC LIMIT 48";
    return { kind, title: table.name + " · Monthly record trend", sql, xKey:"dimension", yKeys:["records"] };
  }
  if ((["line", "area", "bar", "column", "heatmap", "scatter", "combo", "stacked-column"].includes(kind)) && numeric) {
    const expr = numericValueExpression(numeric.column);
    const sql = "SELECT item.value::text AS dimension, COUNT(*)::integer AS records FROM (SELECT " + expr +
      " AS value" + from + ") AS item WHERE item.value IS NOT NULL GROUP BY item.value ORDER BY item.value ASC LIMIT 40";
    return { kind, title: table.name + " · Records by " + numeric.column, sql, xKey:"dimension", yKeys:["records"] };
  }
  if (kind === "card") {
    return { kind, title: table.name + " · Total records",
      sql: "SELECT COUNT(*)::integer AS records" + from, xKey:"records", yKeys:["records"] };
  }
  return null;
}

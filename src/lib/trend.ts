import type { TableInfo, DataResult } from "./database";

export type TrendRequest = {
  table: string;
  entity: string;
  metric: string;
  date: string | null;
  top: number;
};
const metricTerm = /\b(rating|score|price|revenue|sales|value|temperature|quantity|metric)\b/i;
const historyTerm = /\b(trend|historical|history|over time|time series|evolution|trajectory|progression)\b/i;
function quoted(value: string): string { return '"' + value.replace(/"/g, '""') + '"'; }
function isNumericType(type: string) { return /integer|smallint|bigint|numeric|decimal|double precision|real|float|text|varchar|character/i.test(type); }
function numberExpression(name: string, type: string) {
  const col = quoted(name);
  if (!/text|varchar|character/i.test(type)) return col + "::numeric";
  const cleaned = "NULLIF(regexp_replace(" + col + ", '[^0-9.-]', '', 'g'), '')";
  return "CASE WHEN " + cleaned + " ~ '^[-]?[0-9]+([.][0-9]+)?$' THEN " + cleaned + "::numeric END";
}
function requestedTopCount(question: string): number | null {
  const match = /\b(?:top|best|highest)\s+(10|[2-9]|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(question);
  if (!match) return null;
  const words: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
  return words[match[1].toLowerCase()] || Number(match[1]);
}
export function recognizeEntityTrend(question: string, schema: TableInfo[], requireHistory = true): TrendRequest | null {
  if ((requireHistory && !historyTerm.test(question)) || !metricTerm.test(question)) return null;
  const top = requestedTopCount(question);
  if (!top || top < 2) return null;
  const ranked = schema.flatMap(table => {
    const eligibleMetrics = table.columns.filter(c => isNumericType(c.type) &&
      /\b(rating|score|price|revenue|sales|value|temperature|quantity)\b/i.test(c.name.replace(/_/g," ")));
    const exactMatches = eligibleMetrics.filter(c => question.toLowerCase().includes(c.name.replace(/_/g," ").toLowerCase()));
    const partialMatches = eligibleMetrics.filter(c =>
      question.toLowerCase().includes(c.name.split("_").at(-1)?.toLowerCase() || ""));
    // Never silently choose between actual_price and discounted_price, for example.
    const metric = exactMatches.length === 1 ? exactMatches[0] :
      exactMatches.length > 1 ? null : partialMatches.length === 1 ? partialMatches[0] : null;
    const entity = table.columns.find(c => /(^|_)(product|item|service|customer|company|station|city|patient|student|device)_(name|id)$|^name$/i.test(c.name)) || null;
    if (!metric || !entity) return [];
    const root = table.name.replace(/(?:_data|_history|_records|_reviews|_table)$/i,"").toLowerCase();
    const matchName = root && question.toLowerCase().includes(root) ? 3 : 0;
    const matchEntity = question.toLowerCase().includes(entity.name.split("_")[0]) ? 4 : 0;
    const matchMetric = question.toLowerCase().includes(metric.name.replace(/_/g," ")) ? 3 : 0;
    const date = table.columns.find(c => /timestamp|date/i.test(c.type)
      && !/birth|dob|expiry|expiration/i.test(c.name))?.name || null;
    return [{ request: {table:table.name,entity:entity.name,metric:metric.name,date,top}, score:matchName+matchEntity+matchMetric }];
  }).sort((a,b)=>b.score-a.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].request;
}
export function recognizeTopRanking(question: string, schema: TableInfo[]): TrendRequest | null {
  if (historyTerm.test(question) || !/\b(top|best|highest)\b/i.test(question)) return null;
  return recognizeEntityTrend(question, schema, false);
}
export function topRankingSql(request: TrendRequest, schema: TableInfo[]): string | null {
  const table = schema.find(t => t.name === request.table);
  const metric = table?.columns.find(c => c.name === request.metric);
  if (!metric) return null;
  const entity = quoted(request.entity);
  const expr = numberExpression(metric.name,metric.type);
  return "SELECT " + entity + "::text AS entity, AVG(" + expr +
    ")::numeric AS metric_value FROM public." + quoted(request.table) +
    " WHERE " + entity + " IS NOT NULL GROUP BY 1 HAVING COUNT(" + expr +
    ") > 0 ORDER BY metric_value DESC, entity ASC LIMIT " + request.top;
}
export function temporalTrendQuery(trend: TrendRequest, schema: TableInfo[]): string | null {
  if (!trend.date) return null;
  const table = schema.find(t=>t.name===trend.table);
  const metric = table?.columns.find(c=>c.name===trend.metric);
  if (!metric) return null;
  const from = "public." + quoted(trend.table);
  const e = quoted(trend.entity), d = quoted(trend.date);
  const m = numberExpression(trend.metric,metric.type);
  return "WITH measurements AS (SELECT " + e + "::text AS entity, " +
    "date_trunc('month', " + d + ")::date AS period, " + m +
    " AS measurement FROM " + from + " WHERE " + e + " IS NOT NULL AND " + d + " IS NOT NULL), " +
    "ranked AS (SELECT entity FROM measurements WHERE measurement IS NOT NULL GROUP BY entity " +
    "ORDER BY AVG(measurement) DESC LIMIT " + trend.top + ") " +
    "SELECT period::text AS period, entity, AVG(measurement)::numeric AS measurement " +
    "FROM measurements WHERE entity IN (SELECT entity FROM ranked) AND measurement IS NOT NULL " +
    "GROUP BY period, entity ORDER BY period ASC, entity ASC LIMIT 200";
}
export function pivotTemporalTrend(data: DataResult): { data: DataResult; xKey: string; yKeys: string[] } | null {
  const names = [...new Set(data.rows.map(r=>r.entity).filter((v):v is string=>typeof v==="string"))].slice(0,10);
  const periods = [...new Set(data.rows.map(r=>r.period).filter((v):v is string=>typeof v==="string"))].sort();
  if (names.length < 2 || periods.length < 2) return null;
  const rows = periods.map(period => {
    const obj: Record<string, unknown> = {period};
    for (const n of names) {
      const match = data.rows.find(r => r.period===period && r.entity===n);
      obj[n] = match ? Number(match.measurement) : null;
    }
    return obj;
  });
  return { data:{columns:[{name:"period",type:"date"},...names.map(name=>({name,type:"number" as const}))], rows,truncated:data.truncated},
    xKey:"period",yKeys:names };
}
export function missingTrendChoices(request: TrendRequest, reason: "no-date" | "insufficient-data" = "no-date"): {question:string; options:string[]; optionQueries:string[]} {
  const entity = request.entity.replace(/_/g," "), metric=request.metric.replace(/_/g," ");
  const plural=entity.toLowerCase().includes("product")?"products":"records";
  return {
    question: "A " + request.top + "-series " + metric + " trend needs historical observations and dates for each " +
      entity + ". " + (reason === "no-date" ?
      "The selected table ("+request.table+") does not contain a usable date column. " :
      "The available database query did not return repeated observations across multiple dates for at least two entities. ") +
      "I won't invent changes over time. Which real-data analysis would you prefer?",
    options:[
      "Compare top " + request.top + " " + plural + " by current " + metric + " (bar chart)",
      "Show distribution of observed " + metric + " values (line chart; not historical)"
    ],
    optionQueries:[
      "Show the top "+request.top+" "+plural+" by current "+metric+" from public."+request.table+" as a bar chart",
      "Plot the distribution of current "+metric+" values from public."+request.table+" as a line chart (not a time trend)"
    ]
  };
}

import type { TableInfo, DataResult } from "./database";

export type TrendRequest = {
  table: string;
  entity: string;
  metric: string;
  date: string | null;
  top: number;
};
const metricTerm = /\b(rating|rated|score|price|revenue|sales|sell|selling|sold|value|temperature|quantity|qty|units|profit|amount|cost|fare|discount|metric)\b/i;
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
  const match = /\b(?:top|best|highest)\s+(?:the\s+)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(question);
  if (!match) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const n = words[match[1].toLowerCase()] || Number(match[1]);
  return n >= 1 && n <= 100 ? n : null;
}
function tokens(value: string): string[] {
  return value.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^a-z0-9]+/).filter(Boolean);
}
function subjectWords(question: string): string[] {
  const words = tokens(question);
  const synonyms: Record<string, string[]> = {
    product: ["product", "products", "item", "items", "goods", "sku"],
    customer: ["customer", "customers", "buyer", "buyers", "client", "clients"],
    employee: ["employee", "employees", "staff", "worker", "workers"],
    student: ["student", "students", "pupil", "pupils"],
    patient: ["patient", "patients"],
    company: ["company", "companies", "business", "businesses"],
    device: ["device", "devices"],
    city: ["city", "cities"],
    country: ["country", "countries"],
    station: ["station", "stations"],
    passenger: ["passenger", "passengers"],
  };
  return words.flatMap(word => Object.entries(synonyms).find(([, aliases]) => aliases.includes(word))?.[0] || word);
}
function metricMatches(question: string, candidates: {name: string; type: string}[]) {
  const q = question.toLowerCase().replace(/[_-]/g, " ");
  const words = tokens(q);
  const ranked = candidates.map(c => {
    const name = c.name.toLowerCase().replace(/[_-]/g, " ");
    const parts = tokens(c.name);
    const exact = new RegExp("\\b" + name.replace(/\s+/g, "\\s+") + "\\b", "i").test(q);
    const single = parts.length === 1 && words.includes(parts[0]);
    const aliases: Record<string, RegExp> = {
      sales: /\b(sales|sell|selling|sold)\b/i, quantity: /\b(quantity|quantities|units|qty)\b/i,
      revenue: /\b(revenue|turnover)\b/i, rating: /\b(rating|rated)\b/i,
      profit: /\b(profit|profits)\b/i,
    };
    const alias = parts.length === 1 && aliases[parts[0]]?.test(q);
    const generic = parts.some(part => part.length > 2 && words.includes(part));
    const score = exact || single ? 12 : alias ? 9 : generic ? 3 : 0;
    return {c,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  return ranked.length && (!ranked[1] || ranked[0].score > ranked[1].score) ? ranked[0].c : null;
}
function matchingEntity(question: string, columns: {name: string;type: string}[]): string | null {
  const subjects = subjectWords(question);
  const candidates = columns.filter(c => /(^name$|(?:_name|_id)$|^(?:city|country|region|category|department|brand|sku)$)/i.test(c.name));
  const scored = candidates.map(c => {
    const parts = tokens(c.name);
    const prefix = parts.filter(p=>!["name","id","code"].includes(p));
    const match = prefix.some(p => subjects.includes(p)) ? 12 : 0;
    const isName = /(?:^name$|_name$)/i.test(c.name);
    return { column: c.name, score: match + (isName ? 2 : 0), matched: match > 0 };
  }).sort((a,b)=>b.score-a.score);
  const matched = scored.filter(x=>x.matched);
  if (matched.length && (!matched[1] || matched[0].score>matched[1].score)) return matched[0].column;
  // When the user has not named an entity, use only a truly unambiguous single candidate.
  return candidates.length===1 ? candidates[0].name : null;
}
export function recognizeEntityTrend(question: string, schema: TableInfo[], requireHistory = true): TrendRequest | null {
  if ((requireHistory && !historyTerm.test(question)) || !metricTerm.test(question)) return null;
  const top = requestedTopCount(question);
  if (!top) return null;
  const matches = schema.flatMap(table => {
    const eligibleMetrics = table.columns.filter(c => isNumericType(c.type) &&
      /\b(rating|score|price|revenue|sales|value|temperature|quantity|profit|amount|fare|discount|cost|count)\b/i.test(c.name.replace(/_/g," ")));
    const metric = metricMatches(question, eligibleMetrics);
    const entity = matchingEntity(question, table.columns);
    if (!metric || !entity) return [];
    const root = table.name.replace(/(?:_data|_history|_records|_reviews|_table)$/i,"").toLowerCase();
    const tableMatch = root && question.toLowerCase().includes(root) ? 5 : 0;
    const entityWord = entity.split("_")[0].toLowerCase();
    const entityMatch = subjectWords(question).includes(entityWord) ? 5 : 0;
    const date = table.columns.find(c => /timestamp|date/i.test(c.type)
      && !/birth|dob|expiry|expiration/i.test(c.name))?.name || null;
    return [{ request: {table: table.name,entity,metric:metric.name,date,top}, score:tableMatch+entityMatch+2 }];
  }).sort((a,b)=>b.score-a.score);
  if (!matches.length || (matches.length>1 && matches[0].score===matches[1].score)) return null;
  return matches[0].request;
}
export function recognizeTopRanking(question: string, schema: TableInfo[]): TrendRequest | null {
  if (historyTerm.test(question) || !/\b(top|best|highest)\b/i.test(question)) return null;
  return recognizeEntityTrend(question, schema, false);
}
export function topRankingSql(request: TrendRequest, schema: TableInfo[], question = ""): string | null {
  const table = schema.find(t => t.name === request.table);
  const metric = table?.columns.find(c => c.name === request.metric);
  const identity = table?.columns.find(c => c.name === request.entity);
  if (!metric || !identity) return null;
  const entity = quoted(request.entity);
  const expr = numberExpression(metric.name,metric.type);
  // Transactional measures are additive; ratings, prices, temperatures and scores are not.
  // Explicit "average" or "total" overrides the default when meaningful.
  const additive = /\b(sales|revenue|quantity|qty|profit|amount|turnover|units|count|volume)\b/i.test(metric.name.replace(/_/g, " "));
  const aggregation = /\b(avg|average|mean)\b/i.test(question) ? "AVG"
    : /\b(total|sum|combined)\b/i.test(question) ? "SUM"
    : additive ? "SUM" : "AVG";
  return "SELECT " + entity + "::text AS entity, " + aggregation + "(" + expr +
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

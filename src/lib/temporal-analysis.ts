import type { TableInfo } from "./database";
import type { ChartKind } from "./charts";

export type TemporalPlan =
  | { action: "query"; sql: string; title: string; chart: {kind: ChartKind; xKey: string; yKeys: string[]} }
  | { action: "clarify"; question: string; options: string[]; optionQueries: string[] };

const NUMERIC = /integer|bigint|smallint|numeric|decimal|double precision|real|float|money|text|varchar|character/i;
const DATE_TYPE = /date|timestamp/i;
const DATE_NAME = /(?:^|_)(date|time|timestamp|day|month|year|created_at|updated_at)(?:_|$)/i;
const TIME_REQUEST = /\b(monthly|weekly|daily|yearly|annually|quarterly|month.by.month|per month|per week|per day|per year|over time|time series)\b/i;
const RATE = /(?:^|_)(rating|score|rate|percent|percentage|ratio|average|mean|price|cost|temperature|age|discount)(?:_|$)/i;
const QUOTED = (s: string) => '"' + s.replace(/"/g,'""') + '"';
function words(text: string): string[] {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function normalized(text: string): string {
  return words(text).join(" ");
}
function requestedGranularity(q:string): "day"|"week"|"month"|"quarter"|"year" {
  if (/\b(daily|per day|each day)\b/i.test(q)) return "day";
  if (/\b(weekly|per week|each week)\b/i.test(q)) return "week";
  if (/\b(quarterly|per quarter|each quarter)\b/i.test(q)) return "quarter";
  if (/\b(yearly|annually|per year|each year)\b/i.test(q)) return "year";
  return "month";
}
const aliases: Record<string,string[]> = {
  sales:["sale","sales","sell","selling","sold"], revenue:["revenue","turnover"],
  quantity:["quantity","quantities","qty","unit","units"], profit:["profit","profits"],
  amount:["amount","value"], price:["price","pricing"], count:["count","counts","number"],
};
function metricScore(q:string, name:string):number {
  const original = normalized(q), field = normalized(name);
  const parts = words(name);
  if (new RegExp("\\b" + field.replace(/\s+/g,"\\s+") + "\\b","i").test(original)) return 12;
  if (parts.length === 1 && (aliases[parts[0]] || []).some(a=>words(q).includes(a))) return 10;
  if (parts.some(part=>words(q).includes(part) && part.length>=3)) return 4;
  return 0;
}
function metricChoice(question:string, table:TableInfo) {
  const choices = table.columns.filter(c=>NUMERIC.test(c.type) && !DATE_TYPE.test(c.type) && !DATE_NAME.test(c.name) && !/(^id$|_id$|postal|zip|phone)/i.test(c.name))
    .map(c=>({col:c,score:metricScore(question,c.name)}))
    .filter(c=>c.score>0).sort((a,b)=>b.score-a.score);
  if(!choices.length) return {column:null,alternatives:[] as string[]};
  if(choices[1] && choices[0].score===choices[1].score)
    return {column:null, alternatives:choices.filter(c=>c.score===choices[0].score).map(c=>c.col.name).slice(0,5)};
  return {column: choices[0].col, alternatives:[] as string[]};
}
function dateChoice(question:string, table:TableInfo) {
  const candidates=table.columns.filter(c=>DATE_TYPE.test(c.type) || DATE_NAME.test(c.name));
  if(!candidates.length)return {column:null,alternatives:[] as string[]};
  const q=normalized(question);
  const ranked=candidates.map(c=>{
    const name=normalized(c.name), parts=words(c.name);
    const exact=new RegExp("\\b"+name.replace(/\s+/g,"\\s+")+"\\b","i").test(q);
    const explicit=exact?15:parts.some(p=>p!=="date"&&p!=="time"&&q.includes(p))?7:0;
    const order=/^(order|transaction|sale|sales|purchase)[_ ](?:date|time)/i.test(c.name) && /\b(sales|sell|sold|revenue|orders|purchases)\b/i.test(q) ? 3:0;
    return {col:c,score:explicit+order};
  }).sort((a,b)=>b.score-a.score);
  if(ranked.length>1&&ranked[0].score===ranked[1].score)
    return {column:null,alternatives:ranked.map(c=>c.col.name).slice(0,5)};
  return {column:ranked[0].col,alternatives:[] as string[]};
}
function numericExpression(name:string,type:string):string {
  const col=QUOTED(name);
  if(!/text|character|varchar/i.test(type))return col+"::numeric";
  // Currency-formatted numeric text must be checked before casting.
  const cleaned="NULLIF(regexp_replace("+col+"::text, '[^0-9.-]', '', 'g'), '')";
  return "CASE WHEN "+cleaned+" ~ '^[-]?[0-9]+([.][0-9]+)?$' THEN "+cleaned+"::numeric ELSE NULL END";
}
function formatFromQuestion(q:string): "MDY"|"DMY"|null {
  if(/\b(?:MM\/DD\/YYYY|month.first|month first)\b/i.test(q))return "MDY";
  if(/\b(?:DD\/MM\/YYYY|day.first|day first)\b/i.test(q))return "DMY";
  return null;
}
function periodExpression(column:string,type:string,format:string):string {
  const col=QUOTED(column);
  if(DATE_TYPE.test(type))return col+"::date";
  if(format==="ISO") {
    return "CASE WHEN "+col+"::text ~ '^\\d{4}-\\d{2}-\\d{2}(?:[ T].*)?$' THEN LEFT("+col+"::text, 10)::date ELSE NULL END";
  }
  const fmt=format==="MDY"?"MM/DD/YYYY":"DD/MM/YYYY";
  return "CASE WHEN "+col+"::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN to_date("+col+"::text, '"+fmt+"') ELSE NULL END";
}
export function isTemporalQuestion(question:string):boolean {
  return TIME_REQUEST.test(question) && (/\b(trend|graph|chart|plot|show|compare|analy[sz]e|total|sum|average|avg|count|number|sales|sell|sold|revenue|profit)\b/i.test(question));
}
/**
 * Only uses schema-approved columns. Text dates must pass a database-wide format
 * check before they're parsed: never silently omit incompatible rows.
 */
export async function planTemporalAnalysis(
  question:string,schema:TableInfo[],
  check:(sql:string)=>Promise<Record<string,unknown>[]>
):Promise<TemporalPlan|null> {
  if(!isTemporalQuestion(question) || !schema.length) return null;
  const explicitNames=schema.filter(t=>normalized(question).includes(normalized(t.name)));
  const tables=explicitNames.length ? explicitNames : schema;
  if(tables.length!==1)return null; // Leave multi-table joins to the general planner.
  const table=tables[0],from="public."+QUOTED(table.name);
  const original=question.replace(/\s+/g," ").slice(0,600);
  const follow=(column:string,kind:"metric"|"date")=>
    "Create the "+requestedGranularity(question)+"ly trend requested in: "+JSON.stringify(original)+
    ". Use "+kind+" column "+JSON.stringify(column)+" in public."+table.name+
    ". Preserve the other requested filters and grouping. Render a chronological line chart.";
  const date=dateChoice(question,table);
  if(!date.column) {
    if(!date.alternatives.length)return {
      action:"clarify",question:"A time-based trend requires a date or timestamp column. None is identifiable in "+table.name+". Which available date source should be used?",
      options:[],optionQueries:[]
    };
    return {action:"clarify",question:"Which date field should define the trend in "+table.name+"?",
      options:date.alternatives.map(s=>"Use "+s.replace(/_/g," ")),
      optionQueries:date.alternatives.map(s=>follow(s,"date"))};
  }
  const metric=metricChoice(question,table);
  const count=/\b(record|row|order|transaction|event|visit|entry|entries)\s*(?:count|counts|numbers)?\b|\b(count|number of)\s+(?:records|rows|orders|transactions|events)\b/i.test(question)
    && !/\b(sales|sell|sold|revenue|profit|amount|price|quantity|discount|cost)\b/i.test(question);
  if(!count&&!metric.column) {
    const names=metric.alternatives.length?metric.alternatives:
      table.columns.filter(c=>NUMERIC.test(c.type) && !/(^id$|_id$|postal|zip)/i.test(c.name)).map(c=>c.name).slice(0,5);
    if(!names.length)return null;
    return {action:"clarify",question:"Which measurement should be shown over time in "+table.name+"?",
      options:names.map(s=>"Use "+s.replace(/_/g," ")),
      optionQueries:names.map(s=>follow(s,"metric"))};
  }
  let format="ISO";
  if(!DATE_TYPE.test(date.column.type)){
    // Verify the entire column, not only one example or an arbitrary sampled row.
    const col=QUOTED(date.column.name);
    const sql="SELECT COUNT(*)::bigint AS total, "+
      "COUNT(*) FILTER (WHERE "+col+"::text ~ '^\\d{4}-\\d{2}-\\d{2}(?:[ T].*)?$')::bigint AS iso, "+
      "COUNT(*) FILTER (WHERE "+col+"::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$')::bigint AS slash "+
      "FROM "+from+" WHERE "+col+" IS NOT NULL";
    const result=(await check(sql))[0];
    const total=Number(result?.total??0), iso=Number(result?.iso??0), slash=Number(result?.slash??0);
    if(total===0)return {action:"clarify",question:"The selected date column contains no non-null dates. Choose another date field.",
      options:table.columns.filter(c=>c.name!==date.column!.name && (DATE_TYPE.test(c.type)||DATE_NAME.test(c.name))).map(c=>"Use "+c.name),
      optionQueries:table.columns.filter(c=>c.name!==date.column!.name && (DATE_TYPE.test(c.type)||DATE_NAME.test(c.name))).map(c=>follow(c.name,"date"))};
    if(iso===total) format="ISO";
    else if(slash===total) {
      const chosen=formatFromQuestion(question);
      if(!chosen)return {action:"clarify",
        question:"The dates in "+table.name+"."+date.column.name+" use slashes, which may mean two different calendar formats. How should they be interpreted?",
        options:["MM/DD/YYYY (month/day/year)","DD/MM/YYYY (day/month/year)"],
        optionQueries:["MM/DD/YYYY","DD/MM/YYYY"].map(f=>original+"; date format "+f+" for "+date.column!.name+" in public."+table.name)};
      format=chosen;
    } else return {action:"clarify",question:"The date field "+date.column.name+" contains mixed or unsupported formats. Choose another date column or standardize dates in the source dataset first.",
      options:table.columns.filter(c=>c.name!==date.column!.name && (DATE_TYPE.test(c.type)||DATE_NAME.test(c.name))).map(c=>"Use "+c.name),
      optionQueries:table.columns.filter(c=>c.name!==date.column!.name && (DATE_TYPE.test(c.type)||DATE_NAME.test(c.name))).map(c=>follow(c.name,"date"))};
  }
  const grain=requestedGranularity(question);
  const label=count?"record_count": "total_"+metric.column!.name.replace(/[^a-z0-9_]/gi,"_").toLowerCase();
  const expression=count?"COUNT(*)::bigint":
    ((RATE.test(metric.column!.name) || /\b(average|avg|mean)\b/i.test(question)) && !/\b(total|sum)\b/i.test(question)?"AVG":"SUM")+
      "(src.metric_value)::numeric";
  const metricColumn=count?"":", "+numericExpression(metric.column!.name,metric.column!.type)+" AS metric_value";
  const query="SELECT date_trunc('"+grain+"', src.event_date)::date AS period, "+expression+" AS "+QUOTED(label)+
    " FROM (SELECT "+periodExpression(date.column.name,date.column.type,format)+" AS event_date"+metricColumn+
    " FROM "+from+") AS src WHERE src.event_date IS NOT NULL"+
    (count?"":" AND src.metric_value IS NOT NULL")+
    " GROUP BY 1 ORDER BY 1 ASC LIMIT 200";
  return {action:"query",sql:query,title:table.name+" · "+grain+"ly "+(count?"record count":metric.column!.name.replace(/_/g," "))+" trend",
    chart:{kind:"line",xKey:"period",yKeys:[label]}};
}

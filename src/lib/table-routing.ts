import type { TableInfo, DataResult } from "./database";
import type { ChartKind } from "./charts";

export type TableScope = "all" | string;
export type SimpleResult = { sql: string; title: string; chart?: { kind: ChartKind; xKey: string; yKeys: string[] } };
export type ScopePrompt = { question: string; options: string[]; optionQueries: string[] };
export function quoteTableId(value: string): string { return '"' + value.replace(/"/g,'""') + '"'; }
export function resolveTableScope(value: unknown, catalog: TableInfo[]): TableInfo[] {
  if (value === undefined || value === null || value === "all") return catalog;
  if (typeof value !== "string" || !catalog.some(t=>t.name===value))
    throw new Error("Selected table is unavailable in the connected project. Refresh the available tables.");
  return catalog.filter(t=>t.name===value);
}
function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g," ");
}
function scoreTable(question: string, table: TableInfo): number {
  const q = normalized(question), root = normalized(table.name);
  let score = q.includes(root) ? 12 : 0;
  for (const t of root.split(" ").filter(w=>w.length>=4 && !["data","table","records","public"].includes(w))) {
    if (q.includes(t)) score += 7;
  }
  for (const col of table.columns) {
    const key=normalized(col.name);
    if (key.length>3 && q.includes(key)) score += 2;
  }
  const aliases: Record<string,string[]> = {
    survivor:["survivor","survive","surviver","surviber","survival"],
    product:["product","item","goods"],
    passenger:["passenger","traveler"]
  };
  for(const [rootWord,synonyms] of Object.entries(aliases)) {
    if (normalized(table.name).includes(rootWord) || table.columns.some(c=>normalized(c.name).includes(rootWord))) {
      if(synonyms.some(a=>q.includes(a)))score+=8;
    }
  }
  return score;
}
export function identifyQuestionTable(question:string, catalog:TableInfo[]):TableInfo[] {
  const results=catalog.map(table=>({table,score:scoreTable(question,table)})).filter(x=>x.score>=5)
    .sort((a,b)=>b.score-a.score);
  if (!results.length) return [];
  // More than one explicitly mentioned subject means the request may span tables.
  if(results.length>1 && results[1].score>=8 && results[0].score-results[1].score<=5)
    return results.map(x=>x.table);
  return [results[0].table];
}
export function topN(question:string): number | null {
  const m=/\b(?:top|first|list|show|display|get|give(?:\s+me)?)\s+(?:the\s+)?(\d{1,3})\b/i.exec(question);
  if(!m)return null;
  return Math.max(1,Math.min(200,Number(m[1])));
}
function column(table:TableInfo, regex:RegExp) {return table.columns.find(c=>regex.test(c.name));}
const survivalIntent=/\bsurvi[avb][a-z]*\b/i;
export function simpleRequest(question:string,catalog:TableInfo[]):SimpleResult | ScopePrompt | null {
  const top=topN(question);
  if(!top)return null;
  const matched=identifyQuestionTable(question,catalog);
  // Only route to deterministic templates after resolving one unambiguous table.
  if(matched.length!==1)return null;
  const table=matched[0];
  const from="public."+quoteTableId(table.name);
  const survived=column(table,/^(survived|survival|survivor|alive|rescued)$/i);
  if(survived && survivalIntent.test(question)){
    const id=column(table,/^(passenger_?id|record_?id|id|.*_id)$/i);
    const name=column(table,/^(passenger_?name|full_?name|name)$/i);
    const identity=[id,name].filter((c):c is NonNullable<typeof c>=>Boolean(c));
    const names=[...new Set(identity.map(c=>c.name)),survived.name];
    const ordered=id?quoteTableId(id.name)+" ASC":quoteTableId(survived.name)+" DESC";
    const sql="SELECT "+names.map(quoteTableId).join(", ")+" FROM "+from+
      " WHERE "+quoteTableId(survived.name)+" = 1 ORDER BY "+ordered+" LIMIT "+top;
    return {sql,title:"First "+top+" surviving records by "+(id?.name||survived.name)};
  }
  if(/\b(product|item|goods)\b/i.test(question) && /\b(top|first)\b/i.test(question)){
    const metrics=table.columns.filter(c=>/(?:rating|score|price|revenue|sold|sales|quantity)/i.test(c.name));
    const explicit=metrics.filter(c=>normalized(question).includes(normalized(c.name)) ||
      (/(?:rating|rated)/i.test(question)&&/rating/i.test(c.name)&&!/count/i.test(c.name)));
    if(!explicit.length && metrics.length){
      const shown=metrics.filter(c=>!/count/i.test(c.name)).slice(0,4);
      return {question:"What should determine the top "+top+" products in "+table.name+"? The dataset includes these measurements.",
        options:shown.map(c=>"Highest "+c.name.replace(/_/g," ")),
        optionQueries:shown.map(c=>"Show the top "+top+" products by "+c.name+" from public."+table.name)};
    }
  }
  return null;
}
export function resultToData(rows:Record<string,unknown>[]):DataResult {
 const columns=rows[0]?Object.keys(rows[0]).map(name=>{
   const v=rows.find(r=>r[name]!==null&&r[name]!==undefined)?.[name];
   const type:"number"|"date"|"text"= typeof v==="number" ||(typeof v==="string"&&/^-?\d+(\.\d+)?$/.test(v))
     ? "number":typeof v==="string"&&/^\d{4}-\d{2}-\d{2}/.test(v)?"date":"text";
   // Management API results do not expose PostgreSQL field OIDs; infer decimal
   // precision from the returned measurements, not hard-coded table names.
   const numericKind: "integer" | "decimal" | undefined = type !== "number" ? undefined
     : rows.some(row => {
         const sample = row[name];
         return typeof sample === "number" ? !Number.isInteger(sample)
           : typeof sample === "string" && /[.eE]/.test(sample) && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(sample);
       }) ? "decimal" : "integer";
   return {name,type,numericKind};
 }):[];
 return {columns,rows,truncated:false};
}

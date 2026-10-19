import type { TableInfo } from "./database";
import type { ChartKind } from "./charts";
import { quoteTableId } from "./table-routing.ts";

type Row = Record<string,unknown>;
type Reader = (sql: string) => Promise<Row[]>;
export type RelationshipIntent = {kind:"binary-rate"; table:string; outcome:string; dimension?:string};
export type RelationshipResponse =
  | {action:"clarify"; question:string; options:string[]; optionQueries:string[];
      optionIntents?:RelationshipIntent[]; contextIntent?:RelationshipIntent; example?:string}
  | {action:"query"; sql:string; title:string; chart:{kind:ChartKind;xKey:string;yKeys:string[]}}
  | {action:"issue"; message:string};
type Candidate = {table:TableInfo; outcome:string; type:string};
function tokens(s:string):string[] { return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function distance(a:string,b:string):number {
  if(Math.abs(a.length-b.length)>2)return 3;
  let prior=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=0;i<a.length;i++){
    const cur=[i+1];
    for(let j=0;j<b.length;j++) cur.push(Math.min(cur[j]+1,prior[j+1]+1,prior[j]+(a[i]===b[j]?0:1)));
    prior=cur;
  }
  return prior[b.length];
}
function similar(question:string, term:string):boolean {
  const wanted=tokens(term);
  return tokens(question).some(word=>wanted.some(w=>word===w || (word.length>=5&&w.length>=5&&distance(word,w)<=2)));
}
const LABELS: Record<string,string[]> = {
  survived:["survive","survived","survival","survivor","survivers","survibal","surviber","alive"],
  approved:["approval","approved","approve"],
  passed:["pass","passed","passing"],
  converted:["converted","conversion"],
  retained:["retention","retained"],
  recovered:["recovery","recovered"],
  churned:["churn","churned","attrition"],
  completed:["complete","completion","completed"],
};
function matchOutcome(question:string,col:string):boolean {
  if(similar(question,col.replace(/_/g," ")))return true;
  const name=col.toLowerCase();
  return Object.entries(LABELS).some(([key,words])=>
    (name===key||name.includes(key)) && words.some(word=>similar(question,word)));
}
function numericType(type:string):boolean {return /^(?:integer|smallint|bigint|real|double precision|numeric|decimal|boolean)$/i.test(type);}
function privacySensitive(name:string):boolean{
  return /password|token|secret|email|phone|address|first_?name|last_?name|full_?name|passport|ssn|user_?id|account|birth|ip_?address/i.test(name);
}
function possibleDimensions(table:TableInfo,outcome:string) {
  return table.columns.filter(c=>c.name!==outcome && !privacySensitive(c.name) &&
    (/text|varchar|character|citext/i.test(c.type) || numericType(c.type)) &&
    !/(?:^|_)(?:id|identifier)(?:_|$)|(?:id|identifier)$|(?:^|_)name$|^name$|^ticket$/i.test(c.name)).slice(0,12);
}
function outcomeNumber(column:string,type:string):string {
  const q=quoteTableId(column);
  return type.toLowerCase()==="boolean" ? "(CASE WHEN "+q+" THEN 1 ELSE 0 END)" : q;
}
function rateFields(outcome:string,type:string) {
  const expr=outcomeNumber(outcome,type);
  return "COUNT(*)::integer AS total, COUNT(*) FILTER (WHERE "+expr+" = 1)::integer AS positive, " +
    "ROUND(100.0 * COUNT(*) FILTER (WHERE "+expr+" = 1) / NULLIF(COUNT(*),0),2) AS rate_pct";
}
function probabilityIntent(q:string):boolean {
  return /\b(rate|rates|percent|percentage|probability|proportion|ratio|association|relationship|relation|related|correlation|compare|comparison|versus|vs|effect|influence)\b/i.test(q);
}
function numericBucketEdges(min:number,max:number):number[] {
  const width=(max-min)/5;
  if(!(width>0))return [];
  return [1,2,3,4].map(i=>Number((min+width*i).toPrecision(12)));
}
function outcomeOptions(table:TableInfo,subject:string,variableNames:string[]){
  const name=subject.replace(/_/g," ");
  return variableNames.map(col=>({
    label:col.replace(/_/g," ")+" versus "+name+" rate",
    question:"Compare "+name+" rate by "+col+" in public."+table.name,
    intent:{kind:"binary-rate" as const, table:table.name, outcome:subject, dimension:col}
  }));
}
function isVerifiedIntent(value:unknown):value is RelationshipIntent {
  if(!value || typeof value!=="object")return false;
  const obj=value as Record<string,unknown>;
  return obj.kind==="binary-rate" && typeof obj.table==="string" && typeof obj.outcome==="string" &&
    (obj.dimension===undefined || typeof obj.dimension==="string") &&
    obj.table.length<=128 && obj.outcome.length<=128 && (obj.dimension===undefined || obj.dimension.length<=128);
}
function rateMentionScore(question:string,outcome:string):number {
  const wordsOfOutcome=[outcome.replace(/_/g," "),...(LABELS[outcome.toLowerCase()]||[])];
  const wordsInQuestion=tokens(question);
  let score=0;
  for(const name of wordsOfOutcome) {
    const parts=tokens(name);
    for(let i=0;i<wordsInQuestion.length;i++){
      if(!parts.some(p=>p===wordsInQuestion[i]||(p.length>=5 && wordsInQuestion[i].length>=5 && distance(p,wordsInQuestion[i])<=2)))continue;
      if(["rate","rates","percentage","probability","proportion"].includes(wordsInQuestion[i+1]))score=Math.max(score,20);
      if(wordsInQuestion[i-1]==="of" && ["rate","rates","percentage"].includes(wordsInQuestion[i-2]))score=Math.max(score,20);
    }
  }
  return score;
}
export async function relationshipAnalysis(
  question:string, schema:TableInfo[], read:Reader, requestedIntent?:unknown
):Promise<RelationshipResponse|null>{
  const hasIntent=requestedIntent!==undefined && requestedIntent!==null;
  if(hasIntent && !isVerifiedIntent(requestedIntent))
    return {action:"issue",message:"The previous selection is no longer valid. Choose a new analysis from the connected table."};
  const intent=hasIntent ? requestedIntent as RelationshipIntent : null;
  if(!intent && !probabilityIntent(question))return null;

  const candidates:Candidate[] = intent
    ? schema.filter(table=>table.name===intent.table).flatMap(table=>
        table.columns.filter(col=>col.name===intent.outcome && numericType(col.type)).map(col=>
          ({table,outcome:col.name,type:col.type})))
    : schema.flatMap(table=>table.columns.filter(col=>
        numericType(col.type)&&matchOutcome(question,col.name)).map(col=>
        ({table,outcome:col.name,type:col.type})));
  if(intent && candidates.length!==1)
    return {action:"issue",message:"The selected outcome or table is not available in your current authorized table scope."};
  if(!candidates.length)return null;

  // Validate candidate outcomes against actual 0/1 or boolean observations.
  // Mentioning a numeric *dimension* (e.g. Fare) must not make it a rate outcome.
  const verified:Candidate[]=[];
  for(const candidate of candidates.slice(0,8)){
    const from="public."+quoteTableId(candidate.table.name);
    const col=quoteTableId(candidate.outcome);
    const observed=await read("SELECT COUNT(*) FILTER (WHERE "+col+" IS NOT NULL)::integer AS present, "+
      "COUNT(*) FILTER (WHERE "+col+" IS NOT NULL AND "+
      outcomeNumber(candidate.outcome,candidate.type)+" NOT IN (0,1))::integer AS invalid FROM "+from);
    if(Number(observed[0]?.present)>0 && Number(observed[0]?.invalid)===0)verified.push(candidate);
  }
  if(intent && !verified.length)
    return {action:"issue",message:"The selected outcome no longer contains a supported binary (0/1 or boolean) measure."};
  if(!verified.length)return null;

  const topScore=Math.max(...verified.map(item=>rateMentionScore(question,item.outcome)));
  const scored=topScore>0 ? verified.filter(item=>rateMentionScore(question,item.outcome)===topScore):verified;
  if(scored.length>1){
    const choices=scored.slice(0,6).map(item=>({
      label:item.table.name+" · "+item.outcome.replace(/_/g," ")+" rate",
      query:"Analyze "+item.outcome.replace(/_/g," ")+" rate in public."+item.table.name,
      intent:{kind:"binary-rate" as const,table:item.table.name,outcome:item.outcome}
    }));
    return {action:"clarify",
      question:"More than one verified binary outcome matches your question. Select the table and outcome:",
      options:choices.map(c=>c.label),optionQueries:choices.map(c=>c.query),
      optionIntents:choices.map(c=>c.intent),example:choices[0]?.query};
  }
  const {table,outcome,type}=scored[0];
  const tableSql="public."+quoteTableId(table.name);
  const outcomeSql=quoteTableId(outcome);
  const columns=possibleDimensions(table,outcome);
  if(!columns.length)return {action:"issue",message:"No safe comparison fields are available alongside this outcome."};

  // For custom text, resolve only the new answer as a dimension. Preserve the
  // original question as context; never re-detect its outcome from that answer.
  const questionFocus=question.startsWith("CUSTOM CLARIFICATION:")
    ? question.split("\n")[0].replace(/^CUSTOM CLARIFICATION:\s*/,"") : question;
  const specified=intent?.dimension;
  const selected=specified
    ? columns.filter(c=>c.name===specified)
    : columns.filter(c=>similar(questionFocus,c.name.replace(/_/g," ")) ||
        (/(?:^|_)(sex|gender)(?:_|$)/i.test(c.name) && /\b(male|female|men|women)\b/i.test(questionFocus)));
  if(specified && selected.length!==1)
    return {action:"issue",message:"The selected comparison field is unavailable in the current authorized table."};

  if(selected.length!==1){
    // Suggest only actual fields containing at least two distinct non-null values.
    const visible=columns.slice(0,10);
    const aggregates=visible.map((c,i)=>
      "COUNT(DISTINCT "+quoteTableId(c.name)+")::integer AS "+quoteTableId("field_"+i));
    const availability=await read("SELECT "+aggregates.join(", ")+" FROM "+tableSql+
      " WHERE "+outcomeSql+" IS NOT NULL");
    const supported=visible.filter((c,i)=>Number(availability[0]?.["field_"+i])>1);
    const choices=outcomeOptions(table,outcome,supported.map(c=>c.name).slice(0,6));
    if(!choices.length)
      return {action:"issue",message:"The outcome is available, but no comparison field contains enough observations."};
    return {action:"clarify",
      question:selected.length>1 ?
        "Several fields match that request. Choose the comparison dimension:" :
        "Which field should I compare with "+outcome.replace(/_/g," ")+" rate in "+table.name+"?",
      options:choices.map(c=>c.label),optionQueries:choices.map(c=>c.question),
      optionIntents:choices.map(c=>c.intent),
      contextIntent:{kind:"binary-rate",table:table.name,outcome},
      example:choices[0]?.question};
  }
  const variable=selected[0];
  const group=quoteTableId(variable.name);
  const isNumeric=numericType(variable.type) && variable.type.toLowerCase()!=="boolean";
  let numericValueCount=0;
  if(isNumeric){
    const distinct=await read("SELECT COUNT(DISTINCT "+group+")::integer AS distinct_count, MIN("+group+") AS minimum, "+
      "MAX("+group+") AS maximum FROM "+tableSql+" WHERE "+group+" IS NOT NULL AND "+outcomeSql+" IS NOT NULL");
    numericValueCount=Number(distinct[0]?.distinct_count);
    const minimum=Number(distinct[0]?.minimum),maximum=Number(distinct[0]?.maximum);
    if(numericValueCount>12 && Number.isFinite(minimum)&&Number.isFinite(maximum)&&maximum>minimum){
      const edges=numericBucketEdges(minimum,maximum);
      const labels=[minimum,...edges,maximum].map(n=>Number(n.toFixed(2)));
      const when=edges.map((edge,i)=>"WHEN "+group+"::numeric < "+edge+" THEN "+
        "'"+labels[i]+"–"+labels[i+1]+"'").join(" ");
      const expr="CASE "+when+" ELSE '"+labels[4]+"–"+labels[5]+"' END";
      const sql="SELECT "+expr+" AS group_name, "+rateFields(outcome,type)+" FROM "+tableSql+
        " WHERE "+group+" IS NOT NULL AND "+outcomeSql+" IS NOT NULL GROUP BY 1 "+
        "ORDER BY MIN("+group+") ASC LIMIT 30";
      return {action:"query",sql,title:outcome.replace(/_/g," ")+" rate by "+variable.name+" ranges (%)",
        chart:{kind:"bar",xKey:"group_name",yKeys:["rate_pct"]}};
    }
  }
  const sql="SELECT "+group+"::text AS group_name, "+rateFields(outcome,type)+" FROM "+tableSql+
    " WHERE "+group+" IS NOT NULL AND "+outcomeSql+" IS NOT NULL GROUP BY "+group+
    " ORDER BY rate_pct DESC, group_name ASC LIMIT 30";
  return {action:"query",sql,title:outcome.replace(/_/g," ")+" rate by "+variable.name+" (%)",
    chart:{kind:"bar",xKey:"group_name",yKeys:["rate_pct"]}};
}

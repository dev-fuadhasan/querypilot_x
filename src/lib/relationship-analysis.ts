import type { TableInfo } from "./database";
import type { ChartKind } from "./charts";
import { quoteTableId } from "./table-routing";

type Row = Record<string,unknown>;
type Reader = (sql: string) => Promise<Row[]>;
export type RelationshipResponse =
  | { action:"clarify"; question:string; options:string[]; optionQueries:string[]; example?:string }
  | { action:"query"; sql:string; title:string; chart:{kind:ChartKind;xKey:string;yKeys:string[]} };
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
    question:"Compare "+name+" rate by "+col+" in public."+table.name+
      ". For continuous numeric columns use non-overlapping numeric ranges, not individual values."
  }));
}
export async function relationshipAnalysis(
  question:string, schema:TableInfo[], read:Reader
):Promise<RelationshipResponse|null>{
  if(!probabilityIntent(question))return null;
  const matches:Candidate[]=schema.flatMap(table=>table.columns.filter(col=>
    numericType(col.type)&&matchOutcome(question,col.name)).map(col=>
      ({table,outcome:col.name,type:col.type})));
  if(matches.length>1){
    const choices=matches.slice(0,6).map(item=>({
      label:item.table.name+" · "+item.outcome.replace(/_/g," ")+" rate",
      query:"Analyze the relationship with "+item.outcome.replace(/_/g," ")+
        " rate specifically in public."+item.table.name
    }));
    return {action:"clarify",
      question:"More than one authorized table has a matching outcome. Select the dataset to analyze:",
      options:choices.map(c=>c.label),optionQueries:choices.map(c=>c.query),example:choices[0]?.query};
  }
  if(matches.length!==1)return null;
  const {table,outcome,type}=matches[0];
  const tableSql="public."+quoteTableId(table.name);
  const outcomeSql=quoteTableId(outcome);
  const binary=await read("SELECT COUNT(*) FILTER (WHERE "+outcomeSql+" IS NOT NULL)::integer AS present, "+
    "COUNT(*) FILTER (WHERE "+outcomeSql+" IS NOT NULL AND "+outcomeNumber(outcome,type)+" NOT IN (0,1))::integer AS invalid "+
    "FROM "+tableSql);
  if(!binary.length||Number(binary[0].present)<=0||Number(binary[0].invalid)!==0)return null;
  const columns=possibleDimensions(table,outcome);
  if(!columns.length)return null;
  // User can ask without a named dimension. Do not guess a misleading relationship.
  const selected=columns.filter(c=>similar(question,c.name.replace(/_/g," ")) ||
    (/(?:^|_)(sex|gender)(?:_|$)/i.test(c.name) && /\b(male|female|men|women)\b/i.test(question)));
  if(selected.length!==1){
    // Check non-null observations before suggesting dimensions; don't invent options.
    const visible=columns.slice(0,10);
    const aggregates=visible.map((c,i)=>"COUNT(DISTINCT "+quoteTableId(c.name)+")::integer AS "+quoteTableId("field_"+i));
    const availability=await read("SELECT "+aggregates.join(", ")+" FROM "+tableSql+
      " WHERE "+outcomeSql+" IS NOT NULL");
    const supported=visible.filter((c,i)=>Number(availability[0]?.["field_"+i])>1);
    const choices=outcomeOptions(table,outcome,supported.map(c=>c.name).slice(0,6));
    return {action:"clarify",question: selected.length>1?
      "Several fields could explain "+outcome.replace(/_/g," ")+" in "+table.name+". Choose one relationship:":
      "Which field should I compare with "+outcome.replace(/_/g," ")+" rate in "+table.name+"? These fields exist in the selected dataset:",
      options:choices.map(o=>o.label),optionQueries:choices.map(o=>o.question),example:choices[0]?.question};
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

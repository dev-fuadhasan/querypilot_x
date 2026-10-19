// Dataset-agnostic chart selection based on the requested analysis AND the
// executed result shape. This module is deliberately pure (server/client-safe).
export const CHART_TYPES = ["line", "column", "bar", "pie", "donut", "area", "scatter", "radar", "heatmap", "card", "stacked-column", "combo"] as const;
export type ChartKind = typeof CHART_TYPES[number];
export type ChartSpec = {
  type: ChartKind;
  title: string;
  xKey: string;
  yKeys: string[];
  xLabel?: string;
  yLabel?: string;
  seriesLabels?: Record<string,string>;
  note?: string;
  unit?: "%" | null;
};
export type ChartData = {
  columns: { name: string; type: "number" | "date" | "text" }[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
};
const aliases: {type: ChartKind; pattern: RegExp}[] = [
  {type:"stacked-column",pattern:/\b(stacked\s+(?:column|bar|chart)|stacked)\b/i},
  {type:"combo",pattern:/\b(combination|combo|mixed)\s*(?:chart|graph)?\b/i},
  {type:"heatmap",pattern:/\bheat[\s-]?map\b/i},
  {type:"donut",pattern:/\b(donut|doughnut)\b/i},
  {type:"scatter",pattern:/\bscatter(?:\s*(?:plot|chart|graph))?\b/i},
  {type:"radar",pattern:/\b(radar|spider)\s*(?:chart|plot|graph)?\b/i},
  {type:"line",pattern:/\b(line|trend)\s*(?:chart|graph|plot|diagram)\b|\bplot\s+(?:a\s+)?line\b|\bline\s+(?:and|&)\s+(?:pie|bar|column)\b/i},
  {type:"pie",pattern:/\bpie\s*(?:chart|graph|plot)?\b/i},
  {type:"area",pattern:/\barea\s*(?:chart|graph|plot)\b/i},
  {type:"column",pattern:/\b(column|vertical\s+bar)\s*(?:chart|graph|plot)?\b/i},
  {type:"bar",pattern:/\b(horizontal\s+bar|bar)\s*(?:chart|graph|plot)?\b/i},
  {type:"card",pattern:/\b(kpi|metric|statistic|summary)\s*(?:card|tile|dashboard)?s?\b|\bcards?\b/i}
];
export function requestedChartTypes(question: string): ChartKind[] {
  const matches=aliases.flatMap(({type,pattern})=>{
    const index=question.search(pattern);
    return index<0?[]:[{type,index}];
  }).sort((a,b)=>a.index-b.index);
  const types:ChartKind[]=[];
  for(const item of matches) {
    if (item.type==="bar"&&types.includes("stacked-column")) continue;
    if (item.type==="column"&&types.includes("stacked-column"))continue;
    if(!types.includes(item.type))types.push(item.type);
  }
  return types.slice(0,6);
}
export function wantsMultipleCharts(question: string): boolean {
  return /\b(multiple|several|different|various|dashboard|more than one|more charts|all chart types)\b/i.test(question);
}
export function isNumerical(value: unknown): boolean {
  return typeof value==="number"?Number.isFinite(value)
    :typeof value==="string"&&value.trim()!==""&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
      &&Number.isFinite(Number(value));
}
function numeric(value:unknown):number|null{return isNumerical(value)?Number(value):null;}
function pretty(name:string):string {
  return name.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_-]+/g," ").replace(/\s+/g," ").trim()
    .replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bPct\b/g,"%").replace(/\bAvg\b/g,"Average");
}
const ID_FIELD = /(?:^|_)(?:id|uuid|guid|key|code|postal|postcode|zip|sku|serial|phone|rowid)(?:_|$)|^row\s*id$/i;
const MEASURE = /(?:^|_)(?:sales|revenue|profit|price|cost|amount|quantity|qty|rating|score|balance|age|fare|value|total|count|rate|percent|percentage|discount|temperature|distance|duration|weight|height|positive|negative|records|measurement|metric)(?:_|$)/i;
const RATE = /(?:^|_)(?:rate|ratio|average|avg|mean|price|rating|score|margin|percentage|pct|discount)(?:_|$)/i;
const PERCENT = /(?:^|_)(?:pct|percent|percentage)(?:_|$)/i;
function isIdentifier(name:string):boolean{return ID_FIELD.test(name) || /^(?:id|row_id|postal_code|zip_code)$/i.test(name);}
function isDateColumn(name:string,type:string,rows:Record<string,unknown>[]):boolean {
  if(type==="date")return true;
  if(!/(?:^|_)(?:date|day|week|month|quarter|year|period|timestamp|created_at|updated_at)(?:_|$)/i.test(name))return false;
  const values=rows.map(r=>r[name]).filter(v=>v!==null&&v!==undefined);
  if(!values.length)return false;
  return values.every(v=>typeof v==="string"&&
    (/^\d{4}(?:[-/]\d{1,2}){0,2}(?:[ T].*)?$/.test(v)||/^\d{4}-?Q[1-4]$/i.test(v))
    || typeof v==="number"&&Number.isInteger(v)&&v>=1000&&v<=9999);
}
function semanticMetric(name:string,question:string):string {
  if(!/^(metric_value|measurement|value|records|count|total|metric_\d+)$/i.test(name))return pretty(name);
  if(/^(?:records|count)$/i.test(name))return "Record Count";
  const q=question.toLowerCase();
  const known: [RegExp,string][]=[
    [/\b(survival|survived)\s+rate\b/,"Survival Rate"],
    [/\b(sales|selling|sold|sell)\b/,"Sales"],
    [/\brevenue\b/,"Revenue"],[/\bprofit\b/,"Profit"],[/\bquantity|units\s+sold\b/,"Quantity"],
    [/\brating\b/,"Rating"],[/\bprice\b/,"Price"],[/\bcost\b/,"Cost"],
    [/\b(positive|success|conversion)\s+rate\b/,"Rate"],[/\bfare\b/,"Fare"],
    [/\bscore\b/,"Score"],[/\b(balance|amount)\b/,"Amount"],[/\bcount|number of\b/,"Count"],
    [/\brate|percent(age)?\b/,"Rate"]
  ];
  const metric=known.find(([re])=>re.test(q))?.[1]||"Value";
  if(/\baverage|avg|mean\b/.test(q)&&!/^Average\b/.test(metric))return "Average "+metric;
  if(/\b(total|sum|combined)\b/.test(q)&&!/^Total\b/.test(metric))return "Total "+metric;
  return metric;
}
function dimensionLabel(name:string,question:string,temporal:boolean):string {
  if(temporal){
    if(/\b(quarter|quarterly)\b/i.test(question))return "Quarter";
    if(/\b(month|monthly)\b/i.test(question))return "Month";
    if(/\b(week|weekly)\b/i.test(question))return "Week";
    if(/\b(year|yearly|annual)\b/i.test(question))return "Year";
    return /date|time/i.test(name)?"Date":"Period";
  }
  if(!/^(entity|group_name|dimension|category|group|label)$/i.test(name))return pretty(name);
  const by=/\bby\s+([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/i.exec(question)?.[1]||"";
  const phrase=by.replace(/\b(?:in|from|as|with|per|the|of|and)\b.*$/i,"").trim();
  if(phrase&&phrase.length<=28 && !/^(sales|profit|revenue|rating|price|quantity|total|average|count|value)$/i.test(phrase))
    return pretty(phrase);
  const groups:[RegExp,string][]=[
    [/\bproduct(s)?\b/i,"Product"],[/\bcustomer(s)?\b/i,"Customer"],
    [/\b(region|regions)\b/i,"Region"],[/\b(country|countries)\b/i,"Country"],
    [/\bdepartment(s)?\b/i,"Department"],[/\bsex\b/i,"Sex"],[/\bgender\b/i,"Gender"],
    [/\bsegment(s)?\b/i,"Segment"],[/\b(class|pclass)\b/i,"Class"],
    [/\b(city|cities)\b/i,"City"],[/\b(category|categories)\b/i,"Category"]
  ];
  return groups.find(([pattern])=>pattern.test(question))?.[1]||pretty(name);
}
function isPercent(name:string,question:string,measure:string):boolean {
  if(PERCENT.test(name)||/(?:_pct|percentage|percent)$/i.test(name))return true;
  // A generic metric can be in percentage points ONLY when explicitly requested.
  return /^(?:metric_value|measurement|value)$/i.test(name)
    && /\b(percent|percentage)\b|%/i.test(question) && !/\bpercentage point\b/i.test(measure);
}
function safePie(data:ChartData,xKey:string,yKey:string,temporal:boolean):boolean {
  if(temporal || data.truncated || data.rows.length<2 || data.rows.length>8
    || RATE.test(yKey)||PERCENT.test(yKey))return false;
  const names=data.rows.map(r=>r[xKey]);
  if(names.some(v=>v===null||v===undefined||String(v).trim()===""))return false;
  if(new Set(names.map(String)).size!==names.length)return false;
  const values=data.rows.map(row=>numeric(row[yKey]));
  return values.every(v=>v!==null&&v>=0)&&values.some(v=>(v||0)>0);
}
function compatible(kind:ChartKind,data:ChartData,xKey:string,yKeys:string[],temporal:boolean,ordered:boolean):boolean {
  const count=data.rows.length, metrics=yKeys.length;
  if(kind==="card")return count===1 && metrics>=1;
  if(count<2 || !metrics)return false;
  if(kind==="line"||kind==="area")return temporal||ordered;
  if(kind==="scatter")return metrics>=1 && data.rows.every(r=>r[xKey]===null || isNumerical(r[xKey]));
  if(kind==="pie"||kind==="donut")return metrics===1 && safePie(data,xKey,yKeys[0],temporal);
  if(kind==="radar")return metrics>=2 && count>=3 && count<=12 && !temporal;
  if(kind==="stacked-column")return metrics>=2&&!temporal && yKeys.every(k=>data.rows.every(r=>r[k]===null||numeric(r[k])!==null&&Number(r[k])>=0));
  if(kind==="combo")return metrics>=2;
  if(kind==="heatmap")return metrics>=2 && count>=2 && !temporal;
  return kind==="bar"||kind==="column";
}
function titleFor(kind:ChartKind,xLabel:string,yLabel:string,question:string):string {
  if(kind==="card")return "Key Metrics";
  if(kind==="scatter")return yLabel+" vs "+xLabel;
  if(kind==="heatmap")return "Values by "+xLabel;
  if(kind==="radar")return "Metric Comparison by "+xLabel;
  if(kind==="stacked-column")return "Composition by "+xLabel;
  if(kind==="combo")return "Comparison by "+xLabel;
  if(kind==="pie"||kind==="donut")return yLabel+" Share by "+xLabel;
  if(kind==="line"||kind==="area")return yLabel+" Trend by "+xLabel;
  const rank=/\btop\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(question);
  return rank ? "Top "+rank[1]+" "+xLabel+" by "+yLabel : yLabel+" by "+xLabel;
}
function measuresHaveSameUnit(keys:string[]):boolean {
  const groups=keys.map(k=>PERCENT.test(k)?"pct":RATE.test(k)?"ratio":
    /(count|quantity|qty|records|positive|negative)/i.test(k)?"count":
    /(sales|revenue|profit|price|cost|amount|balance|fare)/i.test(k)?"money":"unknown");
  return groups.every(x=>x===groups[0]);
}
function timeOrderedNumeric(name:string,question:string,rows:Record<string,unknown>[]):boolean {
  return /\b(age|year|month|day|week|hour|time|distance|dose|temperature)\b/i.test(name.replace(/_/g," ")) &&
    /\b(over|trend|against|versus|vs|by)\b/i.test(question) &&
    rows.length>=2&&rows.every(r=>isNumerical(r[name]));
}
export function buildDashboardCharts(question:string,data:ChartData,suggestions:ChartSpec[]=[]):ChartSpec[] {
  if(!data.rows.length)return [];
  const columns=data.columns;
  const numericFields=columns.filter(c=>
    !isIdentifier(c.name) && (c.type==="number"||data.rows.some(r=>isNumerical(r[c.name])))
    && !isDateColumn(c.name,c.type,data.rows)).map(c=>c.name);
  const allDates=columns.filter(c=>isDateColumn(c.name,c.type,data.rows)).map(c=>c.name);
  const labelFields=columns.filter(c=>!numericFields.includes(c.name)&&!allDates.includes(c.name)&&
    !isIdentifier(c.name)).map(c=>c.name);
  // Allow semantic ID categories (e.g. product_id), but not row-level IDs.
  const entityIds=columns.filter(c=>/(?:product|customer|group|item|station|store|region)_id$/i.test(c.name)).map(c=>c.name);
  const xFromSuggest=suggestions.find(s=>columns.some(c=>c.name===s.xKey))?.xKey;
  const xKey=xFromSuggest||allDates[0]||labelFields[0]||entityIds[0]||"";
  const temporal=Boolean(xKey&&allDates.includes(xKey));
  const ordered=Boolean(xKey&&!temporal&&timeOrderedNumeric(xKey,question,data.rows));
  const metricFields=numericFields.filter(k=>k!==xKey);
  const candidates=metricFields.length?metricFields:
    // Numeric X/Y pairs in scatterplots are legitimate when no category exists.
    numericFields;
  const explicit=requestedChartTypes(question);
  const requested=explicit.length?explicit:suggestions.map(s=>s.type);
  const numericPair=!temporal&&!labelFields.length&&numericFields.length>=2;
  let kinds:ChartKind[]=requested.length ? [...requested] : [];
  if(!kinds.length){
    if(data.rows.length===1 && metricFields.length)kinds=["card"];
    else if(temporal&&metricFields.length)kinds=["line"];
    else if(ordered&&metricFields.length)kinds=["line"];
    else if(numericPair)kinds=["scatter"];
    else if(xKey&&metricFields.length){
      const longLabels=data.rows.some(r=>String(r[xKey]||"").length>18);
      const ranking=/\b(top|bottom|highest|lowest|best|ranking)\b/i.test(question);
      const distribution=/\b(share|proportion|composition|part of whole)\b/i.test(question);
      kinds=[distribution&&safePie(data,xKey,metricFields[0],false)?"pie":
        ranking||longLabels||data.rows.length>7?"bar":"column"];
    }
  }
  if(wantsMultipleCharts(question)&&!requested.length&&kinds.length){
    const extra:ChartKind[]=temporal?["area","column"]:numericPair?[]:
      ["column","bar",...(xKey&&metricFields.length===1&&safePie(data,xKey,metricFields[0],false)?["donut" as ChartKind]:[])];
    for(const k of extra)if(!kinds.includes(k)&&kinds.length<3)kinds.push(k);
  }
  const out:ChartSpec[]=[];
  for(const kind of kinds.slice(0,6)){
    // Never show record identifiers as metric cards or select an arbitrary row's
    // postal code as a KPI. A raw record remains visible in the result table.
    const source=suggestions.find(s=>s.type===kind);
    let category=source?.xKey&&columns.some(c=>c.name===source.xKey)?source.xKey:xKey;
    let metrics=source?.yKeys?.filter(y=>candidates.includes(y))||[];
    if(!metrics.length)metrics=candidates.slice(0,kind==="line"||kind==="area"?10:4);
    if(kind==="scatter"){
      const pair=numericFields.slice(0,2);
      if(pair.length<2)continue;
      category=source?.xKey && numericFields.includes(source.xKey)?source.xKey:pair[0];
      metrics=[(source?.yKeys||[]).find(k=>numericFields.includes(k)&&k!==category)||pair.find(k=>k!==category)!];
    }
    if(kind==="pie"||kind==="donut")metrics=metrics.slice(0,1);
    if(kind==="card") {
      if(data.rows.length!==1)continue;
      metrics=metricFields.slice(0,4);
      if(!metrics.length)continue;
      // Single row with IDs and many descriptive columns is probably a raw
      // record; cards must be deliberately requested rather than invented.
      const rawRecord=columns.some(c=>isIdentifier(c.name)) && columns.length>metrics.length+1;
      if(rawRecord&&!explicit.includes("card"))continue;
      category=metrics[0];
    }
    if(kind==="line"||kind==="area"){
      if(!temporal&&!ordered)continue;
    }
    if((kind==="stacked-column"||kind==="radar"||kind==="combo")&&!measuresHaveSameUnit(metrics))continue;
    if(!category || !metrics.length || !compatible(kind,data,category,metrics,temporal,ordered))continue;
    if((kind==="pie"||kind==="donut") && (data.truncated || data.rows.length>8))continue;
    const xLabel=dimensionLabel(category,question,temporal);
    const seriesLabels=Object.fromEntries(metrics.map(k=>{
      const base=semanticMetric(k,question);
      return [k,base];
    }));
    const yLabel=metrics.length===1?seriesLabels[metrics[0]]:"Metric Value";
    const percent=metrics.length===1&&isPercent(metrics[0],question,yLabel);
    const valueAxis=percent && !yLabel.includes("%")?yLabel+" (%)":yLabel;
    const note=(kind==="pie"||kind==="donut")?"Shares are relative to the displayed groups only.":undefined;
    const result:ChartSpec={
      type:kind,
      title:source?.title&&source.title!=="Line chart"&&source.title!=="Bar chart"?
        source.title:titleFor(kind,xLabel,yLabel,question),
      xKey:category,yKeys:metrics,xLabel,
      yLabel:valueAxis,seriesLabels,
      ...(percent?{unit:"%" as const}:{}),
      ...(note?{note}:{})
    };
    // One requested type can be reported only once, even if suggestions repeat.
    if(!out.some(c=>c.type===kind))out.push(result);
  }
  return out;
}

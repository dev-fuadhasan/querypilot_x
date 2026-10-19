import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { planTemporalAnalysis, isTemporalQuestion } from "../src/lib/temporal-analysis.ts";
import { recognizeTopRanking, topRankingSql } from "../src/lib/trend.ts";

const superstore={name:"superstore",columns:[
  {name:"row_id",type:"bigint"},{name:"customer_name",type:"text"},
  {name:"product_name",type:"text"},{name:"product_id",type:"text"},
  {name:"order_date",type:"text"},{name:"ship_date",type:"text"},
  {name:"sales",type:"numeric"},{name:"quantity",type:"integer"},
  {name:"profit",type:"numeric"},{name:"discount",type:"numeric"}
]};
const iso=async sql=>{
 assert.match(sql,/COUNT\(\*\) FILTER/);
 return [{total:100,iso:100,slash:0}];
};
test("top products by sales groups product, never first customer name, and sums money",()=>{
  const intent=recognizeTopRanking("Show the top 5 products by sales from public.superstore",[superstore]);
  assert.ok(intent);
  assert.equal(intent.entity,"product_name");
  assert.equal(intent.metric,"sales");
  const sql=topRankingSql(intent,[superstore],"Show the top 5 products by sales");
  assert.match(sql,/SELECT "product_name"::text AS entity, SUM\("sales"::numeric\)/);
  assert.doesNotMatch(sql,/"customer_name"/);
  assert.equal(parse(sql)[0].type,"select");
});
test("same table can rank customers without swapping them for products",()=>{
  const intent=recognizeTopRanking("Top 5 customers by sales in superstore",[superstore]);
  assert.equal(intent?.entity,"customer_name");
  assert.match(topRankingSql(intent,[superstore]),/SUM\(/);
});
test("average sales is respected; ratings default to average rather than sums",()=>{
  const i=recognizeTopRanking("top five products by sales",[superstore]);
  assert.match(topRankingSql(i,[superstore],"top five products by average sales"),/AVG\(/);
  const t={name:"reviews",columns:[{name:"product_name",type:"text"},{name:"rating",type:"numeric"}]};
  const j=recognizeTopRanking("top five products by rating",[t]);
  assert.match(topRankingSql(j,[t]),/AVG\(/);
});
test("monthly sales uses date group + sum of sales with verified ISO text date",async()=>{
  assert.ok(isTemporalQuestion("superstore monthly sell trend line graph"));
  const plan=await planTemporalAnalysis("superstore monthly sell trend line graph",[superstore],iso);
  assert.equal(plan?.action,"query");
  assert.match(plan.sql,/date_trunc\('month'/);
  assert.match(plan.sql,/"order_date"/);
  assert.match(plan.sql,/SUM\(src.metric_value\)/);
  assert.doesNotMatch(plan.sql,/"ship_date"/);
  assert.deepEqual(plan.chart,{kind:"line",xKey:"period",yKeys:["total_sales"]});
  assert.ok(parse(plan.sql).length===1);
});
test("explicit shipping date overrides order date",async()=>{
  const plan=await planTemporalAnalysis("superstore monthly sales trend using ship_date",[superstore],iso);
  assert.equal(plan?.action,"query");
  assert.match(plan.sql,/"ship_date"/);
  assert.doesNotMatch(plan.sql,/"order_date"/);
});
test("slash-date ambiguities ask an actual date-format question, not sales-value filters",async()=>{
  const plan=await planTemporalAnalysis("superstore monthly sales trend line graph",[superstore],
    async()=>[{total:50,iso:0,slash:50}]);
  assert.equal(plan?.action,"clarify");
  assert.ok(plan.options.includes("MM/DD/YYYY (month/day/year)"));
  assert.ok(plan.options.includes("DD/MM/YYYY (day/month/year)"));
  assert.ok(plan.optionQueries.every(q=>q.includes("monthly sales trend")));
});
test("user-defined slash date-format clarification preserves the original query",async()=>{
  const plan=await planTemporalAnalysis("superstore monthly sales trend; date format DD/MM/YYYY",[superstore],
    async()=>[{total:50,iso:0,slash:50}]);
  assert.equal(plan?.action,"query");
  assert.match(plan.sql,/DD\/MM\/YYYY/);
  assert.equal(parse(plan.sql)[0].type,"select");
});
test("typed date and record count work for a completely different schema",async()=>{
  const audits={name:"audit_events",columns:[
    {name:"created_at",type:"timestamp with time zone"},{name:"status",type:"text"},{name:"event_id",type:"bigint"}
  ]};
  let requested=false;
  const plan=await planTemporalAnalysis("show monthly event count trend for audit_events",[audits],async()=>{requested=true;return []});
  assert.equal(plan?.action,"query");
  assert.match(plan.sql,/COUNT\(\*\)::bigint/);
  assert.equal(requested,false);
  assert.equal(parse(plan.sql)[0].type,"select");
});
test("mixed date formats do not silently drop unparseable records",async()=>{
 const plan=await planTemporalAnalysis("superstore monthly sales trend",[superstore],
    async()=>[{total:100,iso:80,slash:20}]);
 assert.equal(plan?.action,"clarify");
 assert.match(plan.question,/mixed or unsupported/);
});

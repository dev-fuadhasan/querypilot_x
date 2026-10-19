import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { recognizeEntityTrend, recognizeTopRanking, temporalTrendQuery, topRankingSql, pivotTemporalTrend, missingTrendChoices } from "../src/lib/trend.ts";
const snapshot=[{name:"sales_data",columns:[
 {name:"product_id",type:"text"},{name:"product_name",type:"text"},
 {name:"discounted_price",type:"text"},{name:"actual_price",type:"text"},{name:"rating",type:"text"},
 {name:"rating_count",type:"text"},{name:"category",type:"text"}
]}];
const historical=[{...snapshot[0],columns:[...snapshot[0].columns,{name:"reviewed_at",type:"timestamp without time zone"}]}];
test("top-five rating trend uses rating not price",()=>{
 const req=recognizeEntityTrend("show top 5 rating product trend",snapshot);
 assert.deepEqual(req,{table:"sales_data",entity:"product_name",metric:"rating",date:null,top:5});
 const choices=missingTrendChoices(req);
 assert.match(choices.question,/does not contain a usable date column/);
 assert.equal(choices.options.length,2);
 assert.equal(temporalTrendQuery(req,snapshot),null);
});
test("snapshot rankings can be rendered as valid bar queries",()=>{
 const req=recognizeTopRanking("top 5 rated products by rating bar chart",snapshot);
 assert.ok(req);assert.equal(req.metric,"rating");
 const sql=topRankingSql(req,snapshot);
 assert.ok(sql);assert.match(sql,/AVG\(/);
 assert.match(sql,/ORDER BY metric_value DESC/);
 assert.equal(parse(sql)[0].type,"select");
});
test("ambiguous price definitions are not silently selected",()=>{
 const request=recognizeTopRanking("top 5 products by price",snapshot);
 assert.equal(request,null);
});
test("historical ratings pivot into five real line series",()=>{
 const req=recognizeEntityTrend("top five product rating trends over time",historical);
 assert.ok(req);assert.equal(req.date,"reviewed_at");
 const sql=temporalTrendQuery(req,historical);
 assert.ok(sql);assert.equal(parse(sql)[0].type,"with");
 const data={columns:[{name:"period",type:"text"},{name:"entity",type:"text"},{name:"measurement",type:"number"}],
  truncated:false,rows:[
    ...["A","B","C","D","E"].map((entity,i)=>({entity,period:"2026-01-01",measurement:3.3+i/10})),
    ...["A","B","C","D","E"].map((entity,i)=>({entity,period:"2026-02-01",measurement:3.5+i/10}))
  ]};
 const p=pivotTemporalTrend(data);
 assert.ok(p);assert.equal(p.yKeys.length,5);assert.equal(p.data.rows.length,2);
 assert.equal(p.data.rows[0].A,3.3);
});
test("one dated snapshot is not a trend",()=>{
 assert.equal(pivotTemporalTrend({columns:[],truncated:false,rows:[{period:"2026-01-01",entity:"A",measurement:4.5}]}),null);
});

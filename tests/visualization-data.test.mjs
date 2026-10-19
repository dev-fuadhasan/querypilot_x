import test from "node:test";
import assert from "node:assert/strict";
import { prepareHorizontalBars, rateHighlights } from "../src/lib/visualization-data.ts";
const columns=[
  {name:"group_name",type:"text"},{name:"total",type:"number"},
  {name:"positive",type:"number"},{name:"rate_pct",type:"number"}
];
const data={columns,rows:[
  {group_name:"female",total:314,positive:233,rate_pct:"74.20"},
  {group_name:"male",total:577,positive:109,rate_pct:"18.89"},
]};
const view={type:"bar",title:"Survival rate by Sex (%)",xKey:"group_name",yKeys:["rate_pct"]};
test("two valid categories always generate two labeled horizontal bars with accurate percentages",()=>{
  const result=prepareHorizontalBars(data,view);
  assert.ok(result);
  assert.equal(result.rows.length,2);
  assert.deepEqual(result.rows.map(row=>row.label),["female","male"]);
  assert.deepEqual(result.rows.map(row=>row.formatted),["74.20%","18.89%"]);
  assert.equal(result.axisMaximum,100);
  assert.deepEqual(result.ticks.map(row=>row.label),["0%","25%","50%","75%","100%"]);
  assert.ok(result.rows[0].percentageOfScale>result.rows[1].percentageOfScale);
  assert.equal(result.rows[1].percentageOfScale,18.89);
});
test("rate cards derive insights from returned rows, never hardcoded values",()=>{
 const summary=rateHighlights(data);
 assert.ok(summary);
 assert.equal(summary.higher.label,"female");
 assert.equal(summary.higher.rate,"74.20%");
 assert.equal(summary.lower.label,"male");
 assert.equal(summary.lower.rate,"18.89%");
 assert.equal(summary.difference,"55.31 pp");
 assert.equal(summary.total,891);
});
test("unrelated category/score charts use dynamic scales without adding percentage symbols",()=>{
 const result=prepareHorizontalBars({
   columns:[{name:"department",type:"text"},{name:"sales",type:"number"}],
   rows:[{department:"Operations",sales:40},{department:"Finance",sales:80},{department:"R&D",sales:120}]
 },{type:"bar",title:"Sales per department",xKey:"department",yKeys:["sales"]});
 assert.ok(result);
 assert.equal(result.rows.length,3);
 assert.deepEqual(result.rows.map(r=>r.label),["Operations","Finance","R&D"]);
 assert.equal(result.isPercentage,false);
 assert.ok(result.axisMaximum>=120);
 assert.ok(result.rows.every(r=>r.percentageOfScale>=0&&r.percentageOfScale<=100));
});
test("invalid metrics, incompatible types and negative inputs are not fabricated",()=>{
 assert.equal(prepareHorizontalBars({columns,rows:[]},view),null);
 assert.equal(prepareHorizontalBars({columns,rows:[{group_name:"X",rate_pct:"not a number"}]},view),null);
 assert.equal(prepareHorizontalBars({columns,rows:[{group_name:"X",rate_pct:-20}]},view),null);
 assert.equal(prepareHorizontalBars(data,{...view,type:"line"}),null);
});
test("one metric row is supported and large labels remain available",()=>{
 const result=prepareHorizontalBars({columns,rows:[{group_name:"Long category description, not a number",rate_pct:0}]},view);
 assert.ok(result);
 assert.equal(result.rows[0].percentageOfScale,0);
 assert.equal(result.rows[0].label,"Long category description, not a number");
 assert.equal(rateHighlights({columns,rows:[{group_name:"X",total:1,positive:1,rate_pct:100}]}),null);
});

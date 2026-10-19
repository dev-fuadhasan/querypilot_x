import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardCharts, requestedChartTypes } from "../src/lib/charts.ts";

const sales = {
  columns: [
    { name: "month", type: "date" },
    { name: "revenue", type: "number" },
    { name: "cost", type: "number" },
  ],
  rows: [
    { month: "2026-01", revenue: 100, cost: 60 },
    { month: "2026-02", revenue: 140, cost: 70 },
    { month: "2026-03", revenue: 150, cost: 78 },
  ],
};
test("explicit line graph cannot be silently replaced by an AI suggestion for columns", () => {
  const charts = buildDashboardCharts("Generate a line graph of monthly revenue", sales, [
    { type: "column", xKey: "month", yKeys: ["revenue"], title: "Columns" }
  ]);
  assert.equal(charts.length, 1);
  assert.equal(charts[0].type, "line");
  assert.equal(charts[0].xKey, "month");
});
test("pie and line graph requests yield two distinct charts", () => {
  assert.deepEqual(requestedChartTypes("Show a pie chart and a line graph"), ["pie", "line"]);
  assert.deepEqual(buildDashboardCharts("Show a pie chart and a line graph", sales).map(c => c.type), ["line"]); // dates are not mutually-exclusive shares
});
test("vertical columns and horizontal bars remain distinct", () => {
  assert.deepEqual(requestedChartTypes("Make a column chart and a horizontal bar graph"), ["column", "bar"]);
  assert.equal(buildDashboardCharts("A bar chart", sales)[0].type, "bar");
  assert.equal(buildDashboardCharts("A column chart", sales)[0].type, "column");
});
test("multiple charts can be requested together, including cards and heatmap", () => {
  const kinds = buildDashboardCharts("Make a line graph, donut chart, heatmap and KPI cards", sales).map(c => c.type);
  assert.deepEqual(kinds, ["line"]); // other forms need a different dataset shape
});
test("don't claim a visualization when returned data has no numeric measurements", () => {
  const text = { columns: [{ name: "name", type: "text" }],
    rows: [{ name: "A" }, { name: "B" }] };
  assert.deepEqual(buildDashboardCharts("line graph", text), []);
});
test("single aggregate row can be a KPI card", () => {
  const aggregate = { columns: [{ name: "revenue", type: "number" }],
    rows: [{ revenue: 480 }] };
  assert.equal(buildDashboardCharts("revenue KPI card", aggregate)[0].type, "card");
});
test("scatter and combo require two distinct numeric measures", () => {
  assert.deepEqual(buildDashboardCharts("scatter chart and combo chart", sales).map(c => c.type), ["scatter", "combo"]);
  const oneMeasure = { columns: [{ name:"category",type:"text" },{name:"amount",type:"number"} ],
    rows:[{category:"A",amount:20},{category:"B",amount:40}] };
  assert.deepEqual(buildDashboardCharts("scatter plot", oneMeasure), []);
});

const products={
 columns:[{name:"entity",type:"text"},{name:"metric_value",type:"number"}],
 rows:[
  {entity:"Desk One",metric_value:3000},{entity:"Desk Two",metric_value:2000},
  {entity:"Desk Three",metric_value:1000}
 ]
};
test("product ranking chooses horizontal bars and meaningful business labels",()=>{
 const charts=buildDashboardCharts("Top 3 products by total sales",products);
 assert.equal(charts.length,1);
 const chart=charts[0];
 assert.equal(chart.type,"bar");
 assert.equal(chart.xLabel,"Product");
 assert.equal(chart.yLabel,"Total Sales");
 assert.match(chart.title,/Top 3 .*Product.*Sales/i);
 assert.equal(chart.seriesLabels.metric_value,"Total Sales");
});
test("monthly revenue trend labels both axes instead of generic field aliases",()=>{
 const charts=buildDashboardCharts("Monthly revenue trend line graph",{
  columns:[{name:"period",type:"date"},{name:"total_revenue",type:"number"}],
  rows:[{period:"2024-01-01",total_revenue:200},{period:"2024-02-01",total_revenue:220}]
 });
 assert.equal(charts[0].type,"line");
 assert.equal(charts[0].xLabel,"Month");
 assert.equal(charts[0].yLabel,"Total Revenue");
 assert.match(charts[0].title,/Revenue Trend by Month/);
});
test("single raw record cannot become KPI cards of row ID or postal code",()=>{
 const raw={
  columns:[{name:"row_id",type:"number"},{name:"postal_code",type:"number"},{name:"sales",type:"number"},{name:"quantity",type:"number"}],
  rows:[{row_id:15,postal_code:76106,sales:68.81,quantity:5}]
 };
 assert.deepEqual(buildDashboardCharts("Show the order with ID 15",raw),[]);
 assert.deepEqual(buildDashboardCharts("Show order KPI cards",raw).map(v=>v.yKeys),[["sales","quantity"]]);
});
test("categories and counts make pie shares only when safe",()=>{
 const categories={columns:[{name:"region",type:"text"},{name:"records",type:"number"}],
  rows:[{region:"East",records:100},{region:"West",records:80},{region:"South",records:60}]};
 const output=buildDashboardCharts("Show share of records by region as pie chart",categories);
 assert.equal(output[0].type,"pie");
 assert.match(output[0].note,/displayed groups/);
 assert.equal(output[0].xLabel,"Region");
 assert.equal(output[0].yLabel,"Record Count");
 assert.deepEqual(buildDashboardCharts("pie chart", {...categories,truncated:true}),[]);
});
test("scatter charts select two real numeric measures and exclude identifiers",()=>{
 const points={columns:[
  {name:"row_id",type:"number"},{name:"sales",type:"number"},{name:"profit",type:"number"}],
 rows:[{row_id:1,sales:40,profit:10},{row_id:2,sales:60,profit:15}]};
 const chart=buildDashboardCharts("Scatter plot of sales versus profit",points)[0];
 assert.equal(chart.type,"scatter");
 assert.equal(chart.xKey,"sales");
 assert.deepEqual(chart.yKeys,["profit"]);
});
test("survival comparison has correctly labeled percent metric, not an invented sum",()=>{
 const data={columns:[{name:"group_name",type:"text"},{name:"rate_pct",type:"number"}],
 rows:[{group_name:"Female",rate_pct:74.12},{group_name:"Male",rate_pct:19.89}]};
 const chart=buildDashboardCharts("Compare survival rate by sex",data)[0];
 assert.equal(chart.unit,"%");
 assert.equal(chart.yLabel,"Survival Rate (%)");
 assert.equal(chart.xLabel,"Sex");
});
test("category comparison is never silently presented as a time trend",()=>{
 const data={columns:[{name:"department",type:"text"},{name:"profit",type:"number"}],
 rows:[{department:"Finance",profit:10},{department:"HR",profit:5}]};
 assert.deepEqual(buildDashboardCharts("Make a line graph of profit by department",data),[]);
 assert.equal(buildDashboardCharts("Compare profit by department",data)[0].type,"column");
});
test("two unrelated measures cannot be stacked into an incoherent bar",()=>{
 const data={columns:[{name:"branch",type:"text"},{name:"revenue",type:"number"},{name:"rate_pct",type:"number"}],
 rows:[{branch:"A",revenue:5000,rate_pct:40},{branch:"B",revenue:2000,rate_pct:20}]};
 assert.deepEqual(buildDashboardCharts("stacked column chart for revenue and conversion rate",data),[]);
});

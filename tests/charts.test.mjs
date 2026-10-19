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
  assert.deepEqual(buildDashboardCharts("Show a pie chart and a line graph", sales).map(c => c.type), ["pie", "line"]);
});
test("vertical columns and horizontal bars remain distinct", () => {
  assert.deepEqual(requestedChartTypes("Make a column chart and a horizontal bar graph"), ["column", "bar"]);
  assert.equal(buildDashboardCharts("A bar chart", sales)[0].type, "bar");
  assert.equal(buildDashboardCharts("A column chart", sales)[0].type, "column");
});
test("multiple charts can be requested together, including cards and heatmap", () => {
  const kinds = buildDashboardCharts("Make a line graph, donut chart, heatmap and KPI cards", sales).map(c => c.type);
  assert.deepEqual(kinds, ["line", "donut", "heatmap", "card"]);
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

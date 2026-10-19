import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { inspectColumns, inspectProject, verifiedChoices, chartQueryFor, isChartOnlyRequest, starterQuestions } from "../src/lib/intelligence.ts";

const sales = { name: "sales_data", columns: [
  { name: "product_id", type: "text" }, { name: "user_email", type: "text" },
  { name: "category", type: "text" }, { name: "rating", type: "text" },
  { name: "actual_price", type: "text" }, { name: "user_name", type: "text" },
]};
const enrollment = { name: "enrollments", columns: [
  { name: "student_id", type: "text" }, { name: "department", type: "text" },
  { name: "score", type: "numeric" }, { name: "status", type: "text" },
]};
const salesRows = [
  { category:"Cables", rating:"4.2",actual_price:"₹1,099" },
  { category:"Televisions", rating:"4.6", actual_price:"₹40,000" },
  { category:"Cables", rating:"3.8", actual_price:"₹399" },
];
const enrollmentRows=[
  { department:"SWE",score:85,status:"Active" },
  { department:"CSE",score:77,status:"Active" },
  { department:"CSE",score:88,status:"Completed" },
];
test("only safe, relevant columns are profiled", () => {
  const cols = inspectColumns(sales);
  const names = [...cols.categories,...cols.numeric,...cols.dates].map(c=>c.name);
  assert.deepEqual(names.sort(),["actual_price","category","rating"].sort());
});
test("live project profile generates verified starters and values dynamically", async () => {
  const queries=[];
  const execute=async sql => {
    queries.push(sql);
    if(sql.includes("sales_data")) return salesRows;
    if(sql.includes("enrollments")) return enrollmentRows;
    return [];
  };
  const profile=await inspectProject([sales,enrollment],execute);
  assert.equal(profile.tables.length,2);
  assert.equal(profile.tables[0].categories[0].values.includes("Televisions"),true);
  assert.equal(profile.tables[0].numeric[0].observed.includes(4.2),true);
  assert.ok(profile.starters.some(x=>x.includes("category")&&x.includes("sales_data")));
  assert.ok(profile.starters.some(x=>x.includes("department")&&x.includes("enrollments")));
  assert.ok(queries.every(x=>!x.includes("user_name")&&!x.includes("user_email")&&!x.includes("product_id")));
});
test("clarification choices are derived from observed values, not inventions", async()=>{
  const profile=await inspectProject([sales],async()=>salesRows);
  const choices=verifiedChoices(profile,"Show records rating 5.3",4);
  assert.ok(choices.length>0);
  assert.ok(choices.some(x=>x.label.includes("observed") && x.label.includes("rating")));
  assert.ok(!choices.some(x=>x.label.includes("5.3")));
});
test("chart-only requests are separated from requests with explicit metrics",()=>{
  assert.equal(isChartOnlyRequest("Make a pie and line graph"),true);
  assert.equal(isChartOnlyRequest("Generate a pie chart and a line chart"),true);
  assert.equal(isChartOnlyRequest("Make a pie and line graph of revenue by month"),false);
});
test("categorical shares use pie and numeric frequencies use bars, not fake timelines",async()=>{
  const profile=await inspectProject([sales],async()=>salesRows);
  const pie=chartQueryFor("pie",profile);
  const bar=chartQueryFor("bar",profile);
  const line=chartQueryFor("line",profile);
  assert.ok(pie&&bar);
  assert.equal(line,null);
  assert.match(pie.sql,/ELSE 'Other'/);
  assert.ok(pie.sql.includes('FROM public."sales_data"'));
  assert.equal(parse(pie.sql)[0].type,"select");
  assert.equal(parse(bar.sql)[0].type,"select");
  assert.ok(profile.starters.every(q=>!q.includes("line graph")));
});
test("dated datasets can still produce monthly chronological line queries",()=>{
 const profile={tables:[{name:"events",categories:[],numeric:[],dates:["created_at"],sampleSize:12}],starters:[]};
 const line=chartQueryFor("line",profile);
 assert.ok(line);
 assert.match(line.sql,/DATE_TRUNC\('month'/);
 assert.match(line.sql,/ORDER BY 1 ASC/);
 assert.equal(parse(line.sql)[0].type,"select");
});
test("starter questions never assume a particular user's business domain",()=>{
  const starters=starterQuestions([{ name:"research_records",
    categories:[{column:"status",values:["Open","Closed"]}],
    numeric:[{column:"score",observed:[30,60]}],
    dates:[], sampleSize:2
  }]);
  assert.ok(starters.every(q=>q.includes("research_records")));
  assert.ok(starters.every(q=>!q.includes("sales perform last month")));
});

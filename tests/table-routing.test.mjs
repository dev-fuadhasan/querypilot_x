import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { resolveTableScope, identifyQuestionTable, simpleRequest } from "../src/lib/table-routing.ts";
import { inspectColumns, inspectProject } from "../src/lib/intelligence.ts";
const tables=[
  {name:"sales_data",columns:[
    {name:"product_id",type:"text"},{name:"product_name",type:"text"},
    {name:"rating",type:"text"},{name:"actual_price",type:"text"},
    {name:"discounted_price",type:"text"},{name:"category",type:"text"}]},
  {name:"titanic_data",columns:[
    {name:"PassengerId",type:"bigint"},{name:"Survived",type:"bigint"},
    {name:"Name",type:"text"},{name:"Sex",type:"text"},{name:"Pclass",type:"bigint"},
    {name:"Age",type:"double precision"},{name:"Fare",type:"double precision"}]},
];
test("All tables includes both tables and named scope restricts them",()=>{
 assert.equal(resolveTableScope("all",tables).length,2);
 assert.deepEqual(resolveTableScope("titanic_data",tables).map(t=>t.name),["titanic_data"]);
 assert.throws(()=>resolveTableScope("private_table",tables),/Selected table/);
});
test("natural-language dataset/topic recognition survives typographical errors",()=>{
 assert.deepEqual(identifyQuestionTable("titanic dataset top 55 surviber?",tables).map(t=>t.name),["titanic_data"]);
 assert.deepEqual(identifyQuestionTable("top 5 product",tables).map(t=>t.name),["sales_data"]);
});
test("top 55 surviving passengers produces a valid read-only query using actual capitalization",()=>{
 const answer=simpleRequest("titanic dataset top 55 surviber?",tables);
 assert.ok(answer && "sql" in answer);
 assert.match(answer.sql,/FROM public."titanic_data"/);
 assert.match(answer.sql,/WHERE "Survived" = 1/);
 assert.match(answer.sql,/LIMIT 55/);
 assert.match(answer.sql,/ORDER BY "PassengerId" ASC/);
 assert.equal(parse(answer.sql)[0].type,"select");
});
test("top 5 products without ranking metric asks grounded, executable choices",()=>{
 const answer=simpleRequest("top 5 product",tables);
 assert.ok(answer && "options" in answer);
 assert.ok(answer.options.some(s=>s.includes("rating")));
 assert.ok(answer.optionQueries.every(s=>s.includes("public.sales_data")));
});
test("different datasets also work: schema-driven categories and numeric selection",async()=>{
 const t={name:"accounts",columns:[
   {name:"region",type:"text"},{name:"status",type:"text"},
   {name:"balance",type:"numeric"},{name:"created_at",type:"timestamp without time zone"}
 ]};
 const fields=inspectColumns(t);
 assert.ok(fields.categories.some(c=>c.name==="region"));
 const profile=await inspectProject([t],async sql=>[{region:"East",status:"active",balance:20,created_at:"2026-10-18"}]);
 assert.equal(profile.tables.length,1);
});
test("Titanic fields are available to discovery without assuming product data",()=>{
 const fields=inspectColumns(tables[1]);
 assert.ok(fields.categories.some(c=>c.name==="Sex"));
 assert.ok(fields.numeric.some(c=>c.name==="Survived"));
 assert.ok(fields.numeric.some(c=>c.name==="Fare"));
});

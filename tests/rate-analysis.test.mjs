import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { planVerifiedBinaryRate } from "../src/lib/rate-analysis.ts";

const schema = [
  { name: "sales_data", columns: [
    { name: "product_name", type: "text" }, { name: "rating", type: "text" },
    { name: "category", type: "text" },
  ] },
  { name: "titanic_data", columns: [
    { name: "PassengerId", type: "bigint" },
    { name: "Survived", type: "bigint" }, { name: "Sex", type: "text" },
    { name: "Name", type: "text" }, { name: "Embarked", type: "text" },
    { name: "Age", type: "double precision" },
  ] },
];
function sampleReader(queries) {
  return async sql => {
    queries.push(sql);
    if (sql.includes('AS present') && sql.includes('"Survived"')) return [{ present: 891, invalid: 0 }];
    if (sql.includes('DISTINCT "Sex"')) return [{ value: "male" }, { value: "female" }];
    if (sql.includes('DISTINCT "Embarked"')) return [{ value: "S" }, { value: "C" }, { value: "Q" }];
    throw new Error("unexpected read-only SQL: " + sql);
  };
}
test("male vs typoed survival rate resolves from the connected schema, not a hardcoded table", async () => {
  const observed = [];
  const plan = await planVerifiedBinaryRate("male vs suurvibal rate", schema, sampleReader(observed));
  assert.ok(plan);
  assert.equal(plan.table, "titanic_data");
  assert.equal(plan.group, "Sex");
  assert.equal(plan.outcome, "Survived");
  assert.match(plan.sql, /FROM public\."titanic_data"/);
  assert.match(plan.sql, /COUNT\(\*\) FILTER \(WHERE "Survived" = 1\)/);
  assert.match(plan.sql, /NULLIF\(COUNT\(\*\), 0\)/);
  assert.match(plan.sql, /GROUP BY "Sex"/);
  assert.equal(parse(plan.sql)[0].type, "select");
  assert.ok(observed.every(sql => !sql.includes('"Name"')));
});
test("correctly spelled comparison and gender wording select the same verified columns", async () => {
  for (const prompt of ["male vs survival rate", "survival rate by sex", "female survival percentage"]) {
    const plan = await planVerifiedBinaryRate(prompt, schema, sampleReader([]));
    assert.ok(plan, prompt);
    assert.equal(plan.group, "Sex");
  }
});
test("rate analysis works with an unrelated approval dataset", async () => {
  const other = [{ name:"requests", columns: [
    { name:"department",type:"text" },{ name:"approved",type:"integer" },
    { name:"salary",type:"numeric" },
  ] }];
  const plan = await planVerifiedBinaryRate("approval rate by department",other,async sql => {
    if(sql.includes("AS present")) return [{present:60,invalid:0}];
    if(sql.includes('DISTINCT "department"')) return [{value:"Operations"},{value:"Finance"}];
    return [];
  });
  assert.ok(plan);
  assert.equal(plan.table,"requests");
  assert.equal(plan.group,"department");
  assert.equal(plan.outcome,"approved");
  assert.equal(parse(plan.sql)[0].type,"select");
});
test("does not infer a binary rate when values are not 0/1", async () => {
  const plan=await planVerifiedBinaryRate("survival rate by sex",schema,async sql=>{
    if(sql.includes("AS present"))return [{present:891,invalid:891}];
    return [];
  });
  assert.equal(plan,null);
});
test("ordinary top-product queries and non-rate prompts skip the binary-rate path", async ()=>{
  let calls=0;
  const plan=await planVerifiedBinaryRate("top 5 products by rating",schema,async()=>{calls++;return []});
  assert.equal(plan,null);
  assert.equal(calls,0);
});

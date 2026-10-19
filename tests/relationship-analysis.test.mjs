import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { relationshipAnalysis } from "../src/lib/relationship-analysis.ts";
import { resolveTableScope } from "../src/lib/table-routing.ts";
import { contextualizeClarification, shouldUseClarificationContext } from "../src/lib/clarification-context.ts";

const sales = {name:"sales_data", columns:[
  {name:"product_name",type:"text"},{name:"discounted_price",type:"text"},
  {name:"rating",type:"text"},{name:"category",type:"text"}]};
const titanic={name:"titanic_data",columns:[
  {name:"PassengerId",type:"bigint"},{name:"Survived",type:"bigint"},
  {name:"Pclass",type:"integer"},{name:"Name",type:"text"},
  {name:"Sex",type:"text"},{name:"Age",type:"double precision"},
  {name:"Ticket",type:"text"},{name:"Fare",type:"double precision"},
  {name:"Embarked",type:"text"}
]};
const schema=[sales,titanic];
function reader(history=[]){
 return async sql=>{
  history.push(sql);
  if(sql.includes("AS present"))return [{present:891,invalid:0}];
  if(sql.includes("AS distinct_count"))return [{distinct_count:88,minimum:0.42,maximum:80}];
  if(sql.includes('AS "field_')){
    const obj={};
    for(const [,id] of sql.matchAll(/AS "field_(\d+)"/g))obj["field_"+id]=3;
    return [obj];
  }
  throw Error("Unknown probe SQL: "+sql);
 };
}
test("All tables relationship is scoped to the actual outcome dataset, not the first sales table",async()=>{
 const logs=[];
 const ans=await relationshipAnalysis("find out relation wwith survibal rate",schema,reader(logs));
 assert.ok(ans);
 assert.equal(ans.action,"clarify");
 assert.ok(ans.question.includes("titanic_data"));
 assert.ok(ans.options.some(x=>/Age versus Survived rate/.test(x)));
 assert.ok(ans.options.some(x=>/Sex versus Survived rate/.test(x)));
 assert.ok(ans.options.some(x=>/Pclass versus Survived rate/.test(x)));
 assert.ok(ans.options.every(x=>!x.includes("sales_data")&&!x.includes("price")&&!x.includes("PassengerId")));
 assert.ok(ans.optionQueries.every(x=>x.includes("titanic_data")));
 assert.ok(logs.every(x=>x.includes('public."titanic_data"')));
});
test("selected table is authoritative and produces identical valid options",async()=>{
 const scoped=resolveTableScope("titanic_data",schema);
 assert.equal(scoped.length,1);
 const ans=await relationshipAnalysis("find out relation wwith survibal rate",scoped,reader());
 assert.equal(ans.action,"clarify");
 assert.ok(ans.options.length>=3);
 assert.ok(ans.options.every(x=>!x.includes("price")));
});
test("short follow-up 'age' preserves original survival-rate context and produces real numeric bands",async()=>{
 const original="find out relation wwith survibal rate";
 const next=contextualizeClarification("age",original);
 assert.equal(shouldUseClarificationContext("age"),true);
 assert.equal(shouldUseClarificationContext("show all products by rating?"),false);
 assert.ok(next.includes("PRIOR REQUEST FOR CONTEXT"));
 const plan=await relationshipAnalysis(next,[titanic],reader());
 assert.equal(plan.action,"query");
 assert.ok(plan.sql.includes('"Age"'));
 assert.ok(plan.sql.includes('"Survived"'));
 assert.ok(plan.sql.includes('FROM public."titanic_data"'));
 assert.match(plan.sql,/GROUP BY 1/);
 assert.match(plan.sql,/rate_pct/);
 assert.equal(plan.chart.kind,"bar");
 assert.equal(parse(plan.sql)[0].type,"select");
});
test("choosing the suggested age option also retains the target table",async()=>{
 const first=await relationshipAnalysis("relationship with survival rate",schema,reader());
 assert.equal(first.action,"clarify");
 const index=first.options.findIndex(x=>/Age/.test(x));
 const plan=await relationshipAnalysis(first.optionQueries[index],schema,reader());
 assert.equal(plan.action,"query");
 assert.match(plan.sql,/public."titanic_data"/);
 assert.match(plan.sql,/COUNT\(\*\) FILTER/);
});
test("sex comparison works and remains SELECT-only",async()=>{
 const plan=await relationshipAnalysis("male vs survibal rate in titanic",[titanic],reader());
 assert.equal(plan.action,"query");
 assert.match(plan.sql,/GROUP BY "Sex"/);
 assert.equal(parse(plan.sql)[0].type,"select");
});
test("different schema with boolean approval outcome yields plausible options",async()=>{
 const other={name:"requests",columns:[
  {name:"approval_status",type:"boolean"},
  {name:"department",type:"text"},
  {name:"account_id",type:"integer"},
  {name:"credit_score",type:"numeric"},
  {name:"region",type:"text"}
 ]};
 const get=async sql=>{
  if(sql.includes("AS present"))return [{present:220,invalid:0}];
  if(sql.includes('AS "field_'))return [{field_0:4,field_1:150,field_2:3}];
  if(sql.includes("AS distinct_count"))return [{distinct_count:150,minimum:100,maximum:900}];
  throw Error(sql);
 };
 const ans=await relationshipAnalysis("Find relationship with approval rate",[other],get);
 assert.ok(ans);
 assert.equal(ans.action,"clarify");
 assert.ok(ans.options.some(x=>x.includes("department")));
 assert.ok(ans.options.every(x=>!x.includes("account_id")));
 const chosen=await relationshipAnalysis("approval rate by credit score in public.requests",[other],get);
 assert.equal(chosen.action,"query");
 assert.match(chosen.sql,/CASE WHEN "approval_status" THEN 1 ELSE 0 END/);
 assert.equal(parse(chosen.sql)[0].type,"select");
});
test("does not build an invented relationship for outcomes absent from selected table",async()=>{
 let called=false;
 const ans=await relationshipAnalysis("survival rate and age",[sales],async()=>{called=true;return []});
 assert.equal(ans,null);
 assert.equal(called,false);
});
test("ambiguous outcome across multiple tables asks which authorized table to use",async()=>{
 const second={...titanic,name:"other_passengers"};
 const ans=await relationshipAnalysis("survival rate relationship",[titanic,second],reader());
 assert.equal(ans.action,"clarify");
 assert.equal(ans.options.length,2);
 assert.ok(ans.options[0].includes("titanic_data"));
 assert.ok(ans.options[1].includes("other_passengers"));
});


test("a verified Fare-vs-Survived choice executes directly rather than treating Fare as another outcome",async()=>{
 const first=await relationshipAnalysis("find out relation wwith survibal rate",schema,reader());
 assert.equal(first.action,"clarify");
 const idx=first.options.findIndex(label=>/^Fare versus Survived rate/.test(label));
 assert.ok(idx>=0);
 assert.deepEqual(first.optionIntents[idx],{
   kind:"binary-rate",table:"titanic_data",outcome:"Survived",dimension:"Fare"
 });
 const follow=await relationshipAnalysis(first.optionQueries[idx],schema,reader(),first.optionIntents[idx]);
 assert.equal(follow.action,"query");
 assert.match(follow.sql,/FROM public\."titanic_data"/);
 assert.match(follow.sql,/WHERE "Fare" IS NOT NULL/);
 assert.match(follow.sql,/COUNT\(\*\) FILTER \(WHERE "Survived" = 1\)/);
 assert.match(follow.sql,/rate_pct/);
 assert.equal(parse(follow.sql)[0].type,"select");
});
test("old text-only choices also identify the verified outcome, never a continuous Fare outcome",async()=>{
 const follow=await relationshipAnalysis("Fare versus Survived rate",schema,async sql=>{
   if(sql.includes('AS present')&&sql.includes('"Fare"'))return [{present:891,invalid:850}];
   return reader()(sql);
 });
 assert.equal(follow.action,"query");
 assert.match(follow.sql,/COUNT\(\*\) FILTER \(WHERE "Survived" = 1\)/);
});
test("a short custom Fare answer is resolved as a dimension while keeping original outcome locked",async()=>{
 const first=await relationshipAnalysis("relationship with survival rate",schema,reader());
 assert.equal(first.action,"clarify");
 const intent=first.contextIntent;
 assert.deepEqual(intent,{kind:"binary-rate",table:"titanic_data",outcome:"Survived"});
 const prompt=contextualizeClarification("Fare","find out relation wwith survibal rate");
 const follow=await relationshipAnalysis(prompt,schema,reader(),intent);
 assert.equal(follow.action,"query");
 assert.match(follow.sql,/"Fare"/);
 assert.match(follow.sql,/"Survived"/);
});
test("outcome selection in All tables mode is a bounded two-step process with no loop",async()=>{
 const second={...titanic,name:"other_passengers"};
 const full=[titanic,second];
 const first=await relationshipAnalysis("relationship with survival rate",full,reader());
 assert.equal(first.action,"clarify");
 assert.equal(first.optionIntents.length,2);
 const secondResult=await relationshipAnalysis(first.optionQueries[1],full,reader(),first.optionIntents[1]);
 assert.equal(secondResult.action,"clarify");
 assert.ok(secondResult.options.every(label=>!label.includes("titanic_data")));
 const third=await relationshipAnalysis(secondResult.optionQueries[0],full,reader(),secondResult.optionIntents[0]);
 assert.equal(third.action,"query");
 assert.match(third.sql,/FROM public\."other_passengers"/);
});
test("out-of-scope or fabricated structured selections are not sent to the AI planner",async()=>{
 let reads=0;
 const x=await relationshipAnalysis("Fare versus Survived rate",[sales],async()=>{reads++;return []},
   {kind:"binary-rate",table:"titanic_data",outcome:"Survived",dimension:"Fare"});
 assert.equal(x.action,"issue");
 assert.equal(reads,0);
 const y=await relationshipAnalysis("Fare versus Survived rate",[titanic],async()=>{reads++;return []},
   {kind:"binary-rate",table:"titanic_data",outcome:"Survived",dimension:"not_a_column"});
 assert.equal(y.action,"issue");
 assert.equal(reads,1); // one bounded binary validation probe
});
test("fields in another company's schema remain dynamic rather than Titanic-specific",async()=>{
 const other={name:"orders",columns:[
   {name:"approved",type:"boolean"},{name:"territory",type:"text"},
   {name:"spend",type:"numeric"},{name:"account_id",type:"integer"}
 ]};
 const read=async sql=>{
   if(sql.includes("AS present"))return [{present:150,invalid:0}];
   if(sql.includes("AS distinct_count"))return [{distinct_count:50,minimum:10,maximum:500}];
   if(sql.includes("AS field_")||sql.includes('AS "field_'))return [{field_0:5,field_1:50}];
   throw Error(sql);
 };
 const first=await relationshipAnalysis("find relationship with approval rate",[other],read);
 assert.equal(first.action,"clarify");
 assert.ok(first.options.some(o=>o.includes("spend")));
 const idx=first.options.findIndex(o=>o.includes("spend"));
 const result=await relationshipAnalysis(first.optionQueries[idx],[other],read,first.optionIntents[idx]);
 assert.equal(result.action,"query");
 assert.match(result.sql,/public\."orders"/);
 assert.match(result.sql,/CASE WHEN "approved" THEN 1 ELSE 0 END/);
 assert.match(result.sql,/"spend"/);
});

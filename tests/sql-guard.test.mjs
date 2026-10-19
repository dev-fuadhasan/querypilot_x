import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAndGuardSql, SqlValidationError } from "../src/lib/sql-guard.ts";
test("allows semicolons, forbidden-looking keywords and comment tokens inside quoted data",()=>{
 const sql="SELECT name FROM public.products WHERE name = 'Sale; -- DROP and UPDATE' LIMIT 5;";
 assert.equal(normalizeAndGuardSql(sql),sql.slice(0,-1));
});
test("strips harmless comments and formatting fences",()=>{
 const sql="SELECT category, COUNT(*) FROM public.products -- query grouped data\nWHERE category = 'cables' /* tag */ GROUP BY category;";
 const normalized=normalizeAndGuardSql(sql);
 assert.ok(!normalized.includes("query grouped data"));
 assert.match(normalized,/GROUP BY category$/);
 const fence=String.fromCharCode(96).repeat(3);
 assert.equal(normalizeAndGuardSql(fence+"sql\nSELECT 1;\n"+fence),"SELECT 1");
});
test("rejects real second statements and writes",()=>{
 for (const q of [
 "SELECT 1; SELECT 2",
 "SELECT * FROM public.products; DELETE FROM public.products",
 "WITH writes AS (DELETE FROM public.products RETURNING *) SELECT * FROM writes",
 "SELECT * FROM auth.users",
 "UPDATE public.products SET price = 2"
 ]) assert.throws(()=>normalizeAndGuardSql(q),SqlValidationError);
});
test("quoted identifiers and text filters containing punctuation are preserved",()=>{
 const sql='SELECT "product_name", COUNT(*) FROM public."sales_data" WHERE "product_name" = \'HDMI; USB -- Cable\' GROUP BY "product_name" LIMIT 5';
 assert.equal(normalizeAndGuardSql(sql),sql);
});
test("unfinished quoted literal is rejected",()=>{
 assert.throws(()=>normalizeAndGuardSql("SELECT * FROM public.sales_data WHERE category='missing"),SqlValidationError);
});

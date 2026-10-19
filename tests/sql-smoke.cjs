const assert = require("node:assert/strict");
const { parse } = require("pgsql-ast-parser");

// Representative of a real dataset where currency/commas are stored in TEXT columns.
const query = `SELECT product_name,
  actual_price,
  NULLIF(regexp_replace(actual_price, '[^0-9.]', '', 'g'), '')::numeric AS numeric_price
FROM public.sales_data
WHERE NULLIF(regexp_replace(actual_price, '[^0-9.]', '', 'g'), '') IS NOT NULL
ORDER BY numeric_price DESC
LIMIT 5`;
const ast = parse(query);
assert.equal(ast.length, 1);
assert.equal(ast[0].type, "select");
console.log("Numeric-text price SQL syntax parser smoke test passed");

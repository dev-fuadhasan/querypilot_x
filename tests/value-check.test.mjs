import test from "node:test";
import assert from "node:assert/strict";
import { findExactNumericFilter, numericStatsSql, rangeCountsSql, rangeDefinitions, buildMissingValueClarification } from "../src/lib/value-check.ts";

const schema = [
  { name: "sales_data", columns: [
    { name: "product_name", type: "text" },
    { name: "rating", type: "text" },
    { name: "actual_price", type: "text" },
  ] },
];

test("detects an exact requested rating on a dynamically discovered table", () => {
  assert.deepEqual(findExactNumericFilter("I need products that have rating 5.3", schema), {
    table: "sales_data", column: "rating", value: 5.3,
  });
  assert.equal(findExactNumericFilter("Show rating above 4.5", schema), null);
  assert.equal(findExactNumericFilter("Top 5 highest rated products", schema), null);
});

test("numeric profile SQL is read-only, schema-qualified and handles text values", () => {
  const filter = findExactNumericFilter("products rating 5.3", schema);
  assert.ok(filter);
  const query = numericStatsSql(filter);
  assert.match(query, /FROM public\."sales_data"/);
  assert.match(query, /regexp_replace/);
  assert.match(query, /exact_matches/);
  assert.match(query, /5\.3/);
});

test("missing rating produces dataset-grounded range options and non-repeating prompts", () => {
  const filter = findExactNumericFilter("products rating 5.3", schema);
  assert.ok(filter);
  const bands = rangeDefinitions(3, 5, 5.3);
  assert.deepEqual(bands, [
    { min: 4.5, max: 5, highInclusive: true },
    { min: 4, max: 4.5, highInclusive: false },
    { min: 3.5, max: 4, highInclusive: false },
  ]);
  const query = rangeCountsSql(filter, bands);
  assert.match(query, /AS count_2/);
  const clarification = buildMissingValueClarification(
    "products rating 5.3", filter,
    { exact_matches: "0", min_value: "3.0", max_value: "5.0", valid_count: "366" },
    bands, { count_0: "18", count_1: "268", count_2: "69" }
  );
  assert.ok(clarification);
  assert.match(clarification.question, /No records.*exactly 5\.3/);
  assert.equal(clarification.options.length, 4);
  assert.match(clarification.options[0], /4\.5 to 5 \(18 matching records\)/);
  assert.match(clarification.optionQueries[0], /rating >= 4\.5/);
  assert.ok(!clarification.optionQueries[0].includes("5.3"));
});

test("matching requested rating never generates a missing-value clarification", () => {
  const filter = { table: "sales_data", column: "rating", value: 4.5 };
  assert.equal(buildMissingValueClarification("rating 4.5", filter,
    { exact_matches: "7", min_value: "3", max_value: "5", valid_count: "366" },
    rangeDefinitions(3, 5, 4.5), {}), null);
});

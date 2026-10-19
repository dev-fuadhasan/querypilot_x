import test from "node:test";
import assert from "node:assert/strict";
import { formatDisplayValue } from "../src/lib/format-values.ts";

const decimal = { name: "rate", type: "number", numericKind: "decimal" };
const integer = { name: "passengers", type: "number", numericKind: "integer" };

test("long PostgreSQL decimal strings display exactly two places", () => {
  assert.equal(formatDisplayValue("1.00000000000000000000", decimal), "1.00");
  assert.equal(formatDisplayValue("1.23500000000000000000", decimal), "1.24");
  assert.equal(formatDisplayValue("-12.5000000000000000", decimal), "-12.50");
  assert.equal(formatDisplayValue("12.3", decimal), "12.30");
  assert.equal(formatDisplayValue("1000.0000000000000", decimal), "1,000.00");
});

test("floating-point numbers and integral decimals have exactly two places", () => {
  assert.equal(formatDisplayValue(1, decimal), "1.00");
  assert.equal(formatDisplayValue(1.2, decimal), "1.20");
  assert.equal(formatDisplayValue(1.2345), "1.23");
  assert.equal(formatDisplayValue("1.00000000000000000000"), "1.00");
});

test("counts and text identifiers are not made fractional or corrupted", () => {
  assert.equal(formatDisplayValue(40, integer), "40");
  assert.equal(formatDisplayValue(1234567, integer), "1,234,567");
  assert.equal(formatDisplayValue("001234", { name: "user_id", type: "text" }), "001234");
  assert.equal(formatDisplayValue("1.000", { name: "version", type: "text" }), "1.000");
  assert.equal(formatDisplayValue("123456789012345678.123", decimal), "123456789012345678.123");
  assert.equal(formatDisplayValue("2026-10-19", { name: "date", type: "date" }), "2026-10-19");
  assert.equal(formatDisplayValue(null), "—");
  assert.equal(formatDisplayValue("N/A"), "N/A");
});

test("numeric-looking text from a new project's measurement column is formatted", () => {
  assert.equal(formatDisplayValue("4.10000000000000", { name: "rating", type: "text" }), "4.10");
  assert.equal(formatDisplayValue("1.2000000", { name: "product_code", type: "text" }), "1.2000000");
});

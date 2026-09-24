import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSideBySideRows, type ParsedBlock } from "../src/lib/sideBySide.ts";

test("pairs deletions with insertions and pads the shorter side", () => {
  const block: ParsedBlock = {
    header: "@@ -1,3 +1,4 @@",
    lines: [
      { type: "context", content: " keep", oldNumber: 1, newNumber: 1 },
      { type: "delete", content: "-old a", oldNumber: 2 },
      { type: "delete", content: "-old b", oldNumber: 3 },
      { type: "insert", content: "+new a", newNumber: 2 },
      { type: "insert", content: "+new b", newNumber: 3 },
      { type: "insert", content: "+new c", newNumber: 4 },
    ],
  };
  const rows = buildSideBySideRows([block]);
  assert.deepEqual(rows[0], { kind: "hunk", header: "@@ -1,3 +1,4 @@" });
  assert.deepEqual(rows[1], {
    kind: "line",
    left: { number: 1, text: "keep", kind: "context" },
    right: { number: 1, text: "keep", kind: "context" },
  });
  assert.deepEqual(rows[2], {
    kind: "line",
    left: { number: 2, text: "old a", kind: "delete" },
    right: { number: 2, text: "new a", kind: "insert" },
  });
  assert.deepEqual(rows[4], {
    kind: "line",
    left: null,
    right: { number: 4, text: "new c", kind: "insert" },
  });
  assert.equal(rows.length, 5);
});

test("pure deletion leaves the right side empty", () => {
  const rows = buildSideBySideRows([
    { header: "@@ -1 +0,0 @@", lines: [{ type: "delete", content: "-gone", oldNumber: 1 }] },
  ]);
  assert.deepEqual(rows[1], {
    kind: "line",
    left: { number: 1, text: "gone", kind: "delete" },
    right: null,
  });
});

// Turns diff2html's parsed hunks into rows for a two-column diff view.
// Within a change run, deletions and insertions are paired index by index;
// whichever side is shorter gets empty filler cells.

export interface ParsedLine {
  type: "insert" | "delete" | "context";
  content: string; // includes the leading "+", "-" or " " marker
  oldNumber?: number;
  newNumber?: number;
}

export interface ParsedBlock {
  header: string;
  lines: ParsedLine[];
}

export interface DiffCell {
  number: number;
  text: string;
  kind: "context" | "delete" | "insert";
}

export type SideBySideRow =
  | { kind: "hunk"; header: string }
  | { kind: "line"; left: DiffCell | null; right: DiffCell | null };

function cell(line: ParsedLine, kind: DiffCell["kind"], number: number | undefined): DiffCell {
  return { number: number ?? 0, text: line.content.slice(1), kind };
}

export function buildSideBySideRows(blocks: ParsedBlock[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  for (const block of blocks) {
    rows.push({ kind: "hunk", header: block.header });
    let deletes: ParsedLine[] = [];
    let inserts: ParsedLine[] = [];

    const flush = () => {
      const count = Math.max(deletes.length, inserts.length);
      for (let i = 0; i < count; i++) {
        const del = deletes[i];
        const ins = inserts[i];
        rows.push({
          kind: "line",
          left: del ? cell(del, "delete", del.oldNumber) : null,
          right: ins ? cell(ins, "insert", ins.newNumber) : null,
        });
      }
      deletes = [];
      inserts = [];
    };

    for (const line of block.lines) {
      if (line.type === "delete") deletes.push(line);
      else if (line.type === "insert") inserts.push(line);
      else {
        flush();
        rows.push({
          kind: "line",
          left: cell(line, "context", line.oldNumber),
          right: cell(line, "context", line.newNumber),
        });
      }
    }
    flush();
  }
  return rows;
}

export interface OverviewMark {
  start: number; // index of the block's first row
  deleted: number;
  inserted: number;
}

// One mark per run of changed rows (deletions and insertions sit on the same
// rows, paired index by index), for a scaled overview of where the changes
// are. `total` is the number of rows, so start/total is the vertical position.
export function buildOverviewMarks(rows: SideBySideRow[]): { marks: OverviewMark[]; total: number } {
  const marks: OverviewMark[] = [];
  let current: OverviewMark | null = null;
  rows.forEach((row, index) => {
    const deleted = row.kind === "line" && row.left?.kind === "delete";
    const inserted = row.kind === "line" && row.right?.kind === "insert";
    if (!deleted && !inserted) {
      current = null;
      return;
    }
    if (!current) {
      current = { start: index, deleted: 0, inserted: 0 };
      marks.push(current);
    }
    if (deleted) current.deleted++;
    if (inserted) current.inserted++;
  });
  return { marks, total: rows.length };
}

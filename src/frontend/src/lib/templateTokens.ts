// `{variable}` templates as typed into a TemplateInput: splitting a value
// into plain text and tokens, and finding the `{partial` being typed.

export interface TemplateVariable {
  name: string;
  color: string;
  description: string;
  /** Sample value shown next to the variable in the suggestions. */
  example?: string;
}

export interface TemplateSegment {
  text: string;
  variable?: TemplateVariable;
  /** A well-formed `{token}` that names no known variable. */
  unknown?: boolean;
}

// Same shape the backend substitutes (`_TEMPLATE_RE` in ci/jenkins.py).
const TOKEN_RE = /\{([A-Za-z0-9_]+)\}/g;
const NAME_RE = /^[A-Za-z0-9_]*$/;

export function splitTemplate(value: string, variables: TemplateVariable[]): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let last = 0;
  for (const match of value.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: value.slice(last, start) });
    const variable = variables.find((v) => v.name === match[1]);
    segments.push({ text: match[0], variable, unknown: !variable });
    last = start + match[0].length;
  }
  if (last < value.length) segments.push({ text: value.slice(last) });
  return segments;
}

/** The `{partial` the caret sits right after, if any. */
export function openTokenAt(value: string, caret: number): { start: number; query: string } | null {
  if (caret <= 0) return null;
  const start = value.lastIndexOf("{", caret - 1);
  if (start < 0) return null;
  const query = value.slice(start + 1, caret);
  return NAME_RE.test(query) ? { start, query } : null;
}

/** Variables matching a typed partial name: prefix matches first, then substring ones. */
export function matchVariables(query: string, variables: TemplateVariable[]): TemplateVariable[] {
  const needle = query.toLowerCase();
  const prefixed = variables.filter((v) => v.name.startsWith(needle));
  const contained = variables.filter((v) => !v.name.startsWith(needle) && v.name.includes(needle));
  return [...prefixed, ...contained];
}

/**
 * End of the range a picked variable replaces, starting from the caret: when
 * the caret is inside an existing `{name}`, the rest of that token goes too;
 * otherwise nothing after the caret is touched.
 */
export function tokenReplaceEnd(value: string, caret: number): number {
  const rest = /^[A-Za-z0-9_]*\}/.exec(value.slice(caret))?.[0] ?? "";
  return caret + rest.length;
}

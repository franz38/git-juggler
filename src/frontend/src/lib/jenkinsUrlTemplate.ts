import type { AppTheme } from "./appTheme.ts";
import { contrast, mix, parseColor, readableOn, toHex } from "./color.ts";
import type { TemplateVariable } from "./templateTokens.ts";

// The example rule a fresh install ships with (EXAMPLE_JENKINS_RULE in
// config.py). "Add rule" starts from it too, on the configured base URL.
export const EXAMPLE_JENKINS_BASE_URL = "https://jenkins.example.com";
export const EXAMPLE_JENKINS_RULE_NAME = "Example rule";

export function exampleJobUrl(baseUrl: string): string {
  return `${(baseUrl.trim() || EXAMPLE_JENKINS_BASE_URL).replace(/\/+$/, "")}/job/{repo_name_url}/job/{branch_name_url}`;
}

// The placeholders the backend substitutes into a Jenkins rule's job URL
// (`_repo_template_values` / `_branch_template_values` in ci/jenkins.py).
// `color` picks a hue from the theme's 6-color branch palette; the three
// extra placeholders get the midpoint of two palette colors so every
// placeholder has a color of its own.
type Color = number | [number, number];

const PLACEHOLDERS: { name: string; description: string; color: Color; sample: (repo: string, branch: string, path: string) => string }[] = [
  { name: "repo_name", description: "Repo folder name", color: 0, sample: (repo) => repo },
  { name: "repo_name_url", description: "Repo folder name, URL-encoded", color: 5, sample: (repo) => urlQuote(repo) },
  { name: "repo_slug", description: "Repo name with unsafe characters replaced by -", color: 4, sample: (repo) => slug(repo) },
  { name: "repo_slug_url", description: "Repo slug, URL-encoded", color: [4, 3], sample: (repo) => urlQuote(slug(repo)) },
  { name: "branch_name", description: "Branch name (resolved after pushes)", color: 1, sample: (_, branch) => branch },
  { name: "branch_name_url", description: "Branch name, URL-encoded", color: 2, sample: (_, branch) => urlQuote(branch) },
  { name: "branch_slug", description: "Branch name with unsafe characters replaced by -", color: 3, sample: (_, branch) => slug(branch) },
  { name: "branch_slug_url", description: "Branch slug, URL-encoded", color: [2, 3], sample: (_, branch) => urlQuote(slug(branch)) },
  { name: "repo_path", description: "Absolute path of the repo on disk", color: [1, 2], sample: (_, __, path) => path },
];

const SAMPLE_REPO_PATH = "/path/to/my-repo";
const SAMPLE_BRANCH = "feature/login";

// Python's `quote(value, safe="")`: everything but A-Z a-z 0-9 _ . - ~ is escaped.
function urlQuote(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Python's `_slug` in ci/jenkins.py.
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || value;
}

function paletteColor(palette: string[], color: Color): string {
  if (typeof color === "number") return palette[color % palette.length];
  const [a, b] = color.map((index) => palette[index % palette.length]);
  const ca = parseColor(a);
  const cb = parseColor(b);
  return ca && cb ? toHex(mix(ca, cb, 0.5)) : a;
}

const MIN_CONTRAST = 3;

// The palette is tuned for lines and badges, not small text: darken (light
// themes) or lighten (dark themes) a color that is too faint on the input,
// like amber on white, keeping its hue.
function legible(color: string, theme: Pick<AppTheme, "vars">): string {
  const bg = parseColor(theme.vars["--input-bg"] ?? theme.vars["--bg"]);
  const base = parseColor(color);
  if (!bg || !base) return color;
  const toward = readableOn(bg);
  let result = base;
  for (let t = 0.1; contrast(result, bg) < MIN_CONTRAST && t <= 1; t += 0.1) result = mix(base, toward, t);
  return result === base ? color : toHex(result);
}

// Placeholders as autocomplete/highlight variables. Examples are rendered
// against `repoPath` (the rule's first repo) when there is one.
export function jenkinsUrlVariables(theme: Pick<AppTheme, "branchPalette" | "vars">, repoPath?: string): TemplateVariable[] {
  const path = repoPath || SAMPLE_REPO_PATH;
  const repo = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return PLACEHOLDERS.map((placeholder) => ({
    name: placeholder.name,
    description: placeholder.description,
    color: legible(paletteColor(theme.branchPalette, placeholder.color), theme),
    example: placeholder.sample(repo, SAMPLE_BRANCH, path),
  }));
}

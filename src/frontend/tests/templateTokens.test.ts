import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_DARK, BUILTIN_LIGHT } from "../src/lib/appTheme.ts";
import { contrast, parseColor } from "../src/lib/color.ts";
import { exampleJobUrl, jenkinsUrlVariables } from "../src/lib/jenkinsUrlTemplate.ts";
import { matchVariables, openTokenAt, splitTemplate, tokenReplaceEnd, type TemplateVariable } from "../src/lib/templateTokens.ts";

const vars = (...names: string[]): TemplateVariable[] => names.map((name) => ({ name, color: "#000000", description: name }));

test("splitTemplate separates known, unknown and plain text", () => {
  const segments = splitTemplate("https://ci/job/{repo_name}/{nope}/{branch", vars("repo_name"));
  assert.deepEqual(
    segments.map((s) => [s.text, s.variable?.name ?? null, Boolean(s.unknown)]),
    [
      ["https://ci/job/", null, false],
      ["{repo_name}", "repo_name", false],
      ["/", null, false],
      ["{nope}", null, true],
      ["/{branch", null, false],
    ],
  );
  assert.deepEqual(splitTemplate("", vars("a")), []);
});

test("openTokenAt finds the partial name before the caret", () => {
  assert.deepEqual(openTokenAt("job/{", 5), { start: 4, query: "" });
  assert.deepEqual(openTokenAt("job/{repo_n", 11), { start: 4, query: "repo_n" });
  assert.deepEqual(openTokenAt("job/{repo_name}/x", 10), { start: 4, query: "repo_" });
  assert.equal(openTokenAt("{repo_name}", 11), null);
  assert.equal(openTokenAt("{a/b", 4), null);
  assert.equal(openTokenAt("{abc", 0), null);
  assert.equal(openTokenAt("abc", 3), null);
});

test("matchVariables lists prefix matches before substring matches", () => {
  const all = vars("repo_name", "repo_name_url", "branch_name", "branch_name_url");
  assert.deepEqual(matchVariables("", all).map((v) => v.name), all.map((v) => v.name));
  assert.deepEqual(matchVariables("Bra", all).map((v) => v.name), ["branch_name", "branch_name_url"]);
  assert.deepEqual(matchVariables("name", all).map((v) => v.name), all.map((v) => v.name));
  assert.deepEqual(matchVariables("url", all).map((v) => v.name), ["repo_name_url", "branch_name_url"]);
  assert.deepEqual(matchVariables("zzz", all), []);
});

test("tokenReplaceEnd swallows the rest of a closed token only", () => {
  assert.equal(tokenReplaceEnd("{repo_name}/x", 5), 11);
  assert.equal(tokenReplaceEnd("{/job/abc", 1), 1);
  assert.equal(tokenReplaceEnd("{repo", 5), 5);
});

test("jenkinsUrlVariables gives every placeholder its own readable color", () => {
  for (const theme of [BUILTIN_DARK, BUILTIN_LIGHT]) {
    const variables = jenkinsUrlVariables(theme);
    assert.equal(new Set(variables.map((v) => v.name)).size, 9);
    assert.equal(new Set(variables.map((v) => v.color.toLowerCase())).size, variables.length, theme.id);
    const bg = parseColor(theme.vars["--input-bg"])!;
    for (const v of variables) assert.ok(contrast(parseColor(v.color)!, bg) >= 3, `${theme.id} ${v.name} ${v.color}`);
  }
});

test("jenkinsUrlVariables keeps palette colors that already read well", () => {
  const variables = jenkinsUrlVariables(BUILTIN_DARK);
  assert.equal(variables.find((v) => v.name === "repo_name")?.color, BUILTIN_DARK.branchPalette[0]);
});

test("jenkinsUrlVariables examples follow the backend's slug and quote rules", () => {
  const example = (name: string) => jenkinsUrlVariables(BUILTIN_DARK, "/work/My Repo (old)").find((v) => v.name === name)?.example;
  assert.equal(example("repo_name"), "My Repo (old)");
  assert.equal(example("repo_name_url"), "My%20Repo%20%28old%29");
  assert.equal(example("repo_slug"), "My-Repo-old");
  assert.equal(example("repo_path"), "/work/My Repo (old)");
  assert.equal(example("branch_name_url"), "feature%2Flogin");
  assert.equal(example("branch_slug"), "feature-login");
});

test("exampleJobUrl builds the example rule's URL on the configured base URL", () => {
  // Same URL the backend seeds a fresh install with (EXAMPLE_JENKINS_RULE).
  assert.equal(exampleJobUrl(""), "https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}");
  assert.equal(exampleJobUrl("  https://ci.acme.dev/ "), "https://ci.acme.dev/job/{repo_name_url}/job/{branch_name_url}");
  assert.equal(exampleJobUrl("https://ci.acme.dev/jenkins//"), "https://ci.acme.dev/jenkins/job/{repo_name_url}/job/{branch_name_url}");
});

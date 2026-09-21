import { test } from "node:test";
import assert from "node:assert/strict";
import type { Preferences } from "../src/api/types.ts";
import { createPreferenceSender } from "../src/lib/preferenceSender.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fast = { delayMs: 5, retryMs: 10, maxRetries: 2 };

test("changes made close together are merged into one request, last write per key wins", async () => {
  const sent: Preferences[] = [];
  const sender = createPreferenceSender(async (patch) => void sent.push(patch), fast);

  sender.save({ theme_id: "a" });
  sender.save({ agent_poll_seconds: 3 });
  sender.save({ theme_id: "b" });
  await wait(30);

  assert.deepEqual(sent, [{ theme_id: "b", agent_poll_seconds: 3 }]);
});

test("changes further apart are sent separately", async () => {
  const sent: Preferences[] = [];
  const sender = createPreferenceSender(async (patch) => void sent.push(patch), fast);

  sender.save({ theme_id: "a" });
  await wait(30);
  sender.save({ agents_enabled: false });
  await wait(30);

  assert.deepEqual(sent, [{ theme_id: "a" }, { agents_enabled: false }]);
});

test("falsy values (false, 0-length list) are sent, not dropped", async () => {
  const sent: Preferences[] = [];
  const sender = createPreferenceSender(async (patch) => void sent.push(patch), fast);

  sender.save({ agents_enabled: false, pinned_themes: [] });
  await wait(30);

  assert.deepEqual(sent, [{ agents_enabled: false, pinned_themes: [] }]);
});

test("a failed send is retried, and a newer value made meanwhile wins over the failed one", async () => {
  const sent: Preferences[] = [];
  let failures = 1;
  const sender = createPreferenceSender(async (patch) => {
    if (failures-- > 0) throw new Error("offline");
    sent.push(patch);
  }, fast);

  sender.save({ theme_id: "old", pinned_themes: ["p"] });
  await wait(8); // first attempt fails
  sender.save({ theme_id: "new" });
  await wait(60);

  assert.deepEqual(sent, [{ theme_id: "new", pinned_themes: ["p"] }]);
});

test("gives up after maxRetries", async () => {
  let attempts = 0;
  const sender = createPreferenceSender(async () => {
    attempts++;
    throw new Error("down");
  }, fast);

  sender.save({ theme_id: "a" });
  await wait(120);

  assert.equal(attempts, 1 + fast.maxRetries);
});

test("unsentKeys reports pending and in-flight keys, and clears after success", async () => {
  let release: () => void = () => {};
  const sender = createPreferenceSender(() => new Promise<void>((resolve) => (release = resolve)), fast);

  sender.save({ theme_id: "a" });
  assert.deepEqual(sender.unsentKeys(), ["theme_id"]);

  await wait(15); // now in flight
  assert.deepEqual(sender.unsentKeys(), ["theme_id"]);

  release();
  await wait(5);
  assert.deepEqual(sender.unsentKeys(), []);
});

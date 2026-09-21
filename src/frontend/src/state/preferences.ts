import { fetchPreferences } from "../api/client";
import type { Preferences } from "../api/types";
import { preferenceSender, savePreference } from "./preferenceSync";
import { applyRemotePreferences } from "./store";
import { applyRemoteThemePreferences } from "./themes";

/**
 * Pulls the shared preferences from the backend and reconciles them with this
 * browser's local copy (see applyRemotePreferences / applyRemoteThemePreferences).
 * Values only this browser has are uploaded, so the first browser to run
 * against a fresh backend seeds everyone else's settings. If the backend is
 * unreachable, the local values simply stay in effect.
 */
export async function loadPreferences(): Promise<void> {
  let remote: Preferences;
  try {
    remote = await fetchPreferences();
  } catch {
    return;
  }

  // A change made while the request was in flight is newer than the server's
  // answer; don't let the answer overwrite it.
  for (const key of preferenceSender.unsentKeys()) {
    delete remote[key as keyof Preferences];
  }

  const seed = { ...applyRemotePreferences(remote), ...applyRemoteThemePreferences(remote) };
  if (Object.keys(seed).length > 0) savePreference(seed);
}

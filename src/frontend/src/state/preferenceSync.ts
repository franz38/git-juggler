import { updatePreferences } from "../api/client";
import { createPreferenceSender } from "../lib/preferenceSender";

// The one sender every setting writes through. Kept in its own module so both
// store.ts and themes.ts can use it without importing each other.
export const preferenceSender = createPreferenceSender(updatePreferences);
export const savePreference = preferenceSender.save;

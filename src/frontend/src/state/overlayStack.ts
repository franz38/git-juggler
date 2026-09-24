import { createEffect, createSignal, onCleanup } from "solid-js";

// Tracks which overlay panels (menu, palette, modals, ...) are open, in the
// order they were opened. The last one is the topmost: it gets the highest
// z-index and is the one Escape closes.

const BASE_Z_INDEX = 100;

const [stack, setStack] = createSignal<string[]>([]);
const closers = new Map<string, () => void>();

// Call once from an overlay's component body. `isOpen` is reactive; `close`
// is what Escape runs when this overlay is the topmost one.
export function useOverlay(id: string, isOpen: () => boolean, close: () => void): void {
  closers.set(id, close);
  createEffect(() => {
    if (isOpen()) setStack((s) => (s.includes(id) ? s : [...s, id]));
    else setStack((s) => s.filter((entry) => entry !== id));
  });
  onCleanup(() => {
    closers.delete(id);
    setStack((s) => s.filter((entry) => entry !== id));
  });
}

// Inline z-index for an overlay: later-opened panels sit above earlier ones.
export function overlayZIndex(id: string): number | undefined {
  const index = stack().indexOf(id);
  return index < 0 ? undefined : BASE_Z_INDEX + index;
}

// Closes the topmost open overlay. Returns false when none is open.
export function closeTopOverlay(): boolean {
  const list = stack();
  const top = list[list.length - 1];
  if (!top) return false;
  closers.get(top)?.();
  return true;
}

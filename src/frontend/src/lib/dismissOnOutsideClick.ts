import { onCleanup, onMount } from "solid-js";

// Closes a floating panel (e.g. a context menu) when the user presses a
// mouse button anywhere outside it. Unlike a full-screen overlay div, this
// never physically blocks clicks: a right-click on a different row/badge
// still reaches that element's own contextmenu handler, so the old menu
// closes and the new one opens in the same gesture instead of the first
// right-click being swallowed by the previous menu's overlay.
export function dismissOnOutsideClick(getPanel: () => HTMLElement | undefined, onDismiss: () => void): void {
  const handlePointerDown = (e: PointerEvent) => {
    const panel = getPanel();
    if (panel && !panel.contains(e.target as Node)) onDismiss();
  };
  onMount(() => {
    document.addEventListener("pointerdown", handlePointerDown);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", handlePointerDown);
  });
}

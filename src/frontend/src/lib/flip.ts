// Minimal FLIP (First, Last, Invert, Play) helper for animating an element
// that just moved to a new position (e.g. after a live drag-swap reorder),
// without a full animation library.
export function flipTranslate(el: HTMLElement, dx: number, dy: number, duration = 150): void {
  if (dx === 0 && dy === 0) return;
  el.style.transition = "none";
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  // Force a reflow so the browser commits the "start" transform before we
  // switch to animating away from it, instead of collapsing both style
  // writes into a single frame (which would skip the animation).
  void el.getBoundingClientRect();
  requestAnimationFrame(() => {
    el.style.transition = `transform ${duration}ms ease`;
    el.style.transform = "";
    const cleanup = () => {
      el.style.transition = "";
      el.removeEventListener("transitionend", cleanup);
    };
    el.addEventListener("transitionend", cleanup);
  });
}

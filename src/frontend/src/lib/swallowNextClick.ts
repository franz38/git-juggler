/**
 * Cancels the click that completes the press in progress. Used when a press
 * only dismisses something (a popover): the same click must not also act on
 * whatever is underneath, e.g. select a commit in the graph.
 *
 * Call it from a mousedown handler. The guard removes itself after that click,
 * or right after the button is released if no click follows (a drag ending
 * elsewhere).
 */
export function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const release = () => {
    // The click is dispatched right after mouseup; drop the guard once it has passed.
    window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  };
  window.addEventListener("click", swallow, { capture: true });
  window.addEventListener("mouseup", release, { capture: true, once: true });
}

const SCROLL_DURATION_MS = 300;
const FLASH_DURATION_MS = 700;
const SCROLL_CONTAINER_SELECTOR = ".graph-and-list";

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// Native `scrollIntoView({ behavior: "smooth" })` turned out to silently
// no-op in some browser contexts, so we drive the scroll ourselves — this
// also gives us a hook to flash the row once it lands.
export function scrollToCommit(hash: string): void {
  const row = document.getElementById(`commit-row-${hash}`);
  const container = document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
  if (!row || !container) return;

  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const startTop = container.scrollTop;
  const delta = rowRect.top - containerRect.top - container.clientHeight / 2 + rowRect.height / 2;
  const targetTop = Math.max(0, Math.min(startTop + delta, container.scrollHeight - container.clientHeight));
  const startTime = performance.now();

  function step(now: number): void {
    const progress = Math.min((now - startTime) / SCROLL_DURATION_MS, 1);
    container!.scrollTop = startTop + (targetTop - startTop) * easeOutQuad(progress);
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      row!.classList.add("flash");
      window.setTimeout(() => row!.classList.remove("flash"), FLASH_DURATION_MS);
    }
  }
  requestAnimationFrame(step);
}

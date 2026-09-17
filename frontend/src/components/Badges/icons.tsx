// Small hand-rolled glyphs (no icon library) so branch/tag/stash badges stay
// visually distinguishable at a glance, on top of their color.

export function BranchIcon() {
  return (
    <svg class="badge-icon" viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
      <circle cx="3" cy="2.2" r="1.3" fill="currentColor" />
      <circle cx="3" cy="9.8" r="1.3" fill="currentColor" />
      <circle cx="9" cy="6" r="1.3" fill="currentColor" />
      <path d="M3 3.5 V8.5 M3 6 H9" fill="none" stroke="currentColor" stroke-width="1.1" />
    </svg>
  );
}

export function TagIcon() {
  return (
    <svg class="badge-icon" viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
      <path d="M1 5.3 L5.3 1 H10 a1 1 0 0 1 1 1 v4.7 L6.7 11 Z" fill="none" stroke="currentColor" stroke-width="1.1" />
      <circle cx="8" cy="4" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function StashIcon() {
  return (
    <svg class="badge-icon" viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
      <path d="M1 3 L6 1 L11 3 L6 5 Z" fill="currentColor" />
      <path d="M1 6.2 L6 8.2 L11 6.2" fill="none" stroke="currentColor" stroke-width="1.1" />
      <path d="M1 9 L6 11 L11 9" fill="none" stroke="currentColor" stroke-width="1.1" />
    </svg>
  );
}

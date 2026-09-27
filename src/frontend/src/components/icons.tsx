// Small hand-rolled glyphs (no icon library), shared across the sidebar,
// commit search, and CI badges.

export function BranchIcon(props: { size?: number }) {
  return (
    <svg class="badge-icon" viewBox="0 0 12 12" width={props.size ?? 9} height={props.size ?? 9} aria-hidden="true">
      <circle cx="3" cy="2.2" r="1.3" fill="currentColor" />
      <circle cx="9" cy="2.2" r="1.3" fill="currentColor" />
      <circle cx="3" cy="9.8" r="1.3" fill="currentColor" />
      <path d="M3 3.5 V8.5" fill="none" stroke="currentColor" stroke-width="1.1" />
      <path d="M9 3.5 V6 Q9 7.2 7.8 7.2 H3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
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

// The GitHub mark (github-logo.svg), filled with the current text colour so it
// follows the theme.
export function GitHubIcon(props: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 13} height={props.size ?? 13} aria-hidden="true">
      <path
        fill="currentColor"
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
      />
    </svg>
  );
}

// The Jenkins butler (a full-colour picture, readable on any theme).
export function JenkinsIcon(props: { size?: number }) {
  return <img class="ci-provider-logo" src="/ci-logos/jenkins.webp" alt="" width={props.size ?? 13} height={props.size ?? 13} />;
}

// A filled funnel, for the commit-filter button.
export function FilterIcon(props: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 14} height={props.size ?? 14} aria-hidden="true">
      <path d="M2 3h12L9.5 8v4l-3 1V8L2 3z" fill="currentColor" />
    </svg>
  );
}

// A downward caret, for dropdown/multiselect triggers.
export function CaretDownIcon(props: { size?: number }) {
  return (
    <svg class="multiselect-caret" viewBox="0 0 16 16" width={props.size ?? 10} height={props.size ?? 10} aria-hidden="true">
      <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

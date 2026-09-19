// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\r/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

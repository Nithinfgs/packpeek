export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  cyan(s: string): string;
  magenta(s: string): string;
  gray(s: string): string;
}

const wrap = (open: number, close: number, on: boolean) => (s: string) => (on ? `\u001b[${open}m${s}\u001b[${close}m` : s);

export function makeStyle(enabled: boolean): Style {
  return {
    bold: wrap(1, 22, enabled),
    dim: wrap(2, 22, enabled),
    red: wrap(31, 39, enabled),
    yellow: wrap(33, 39, enabled),
    green: wrap(32, 39, enabled),
    cyan: wrap(36, 39, enabled),
    magenta: wrap(35, 39, enabled),
    gray: wrap(90, 39, enabled),
  };
}

export function colorEnabled(stream: NodeJS.WriteStream, flagNoColor: boolean): boolean {
  if (flagNoColor || process.env["NO_COLOR"]) return false;
  if (process.env["FORCE_COLOR"] && process.env["FORCE_COLOR"] !== "0") return true;
  return Boolean(stream.isTTY);
}

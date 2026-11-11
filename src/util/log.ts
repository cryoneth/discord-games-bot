/**
 * Minimal logger. By design it never receives message content, tokens or
 * usernames — only operational events and error messages.
 */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, msg: string, err?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}`;
  const detail = err instanceof Error ? ` :: ${err.name}: ${err.message}` : err ? ` :: ${String(err)}` : '';
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line + detail);
}

export const log = {
  info: (msg: string) => write('info', msg),
  warn: (msg: string, err?: unknown) => write('warn', msg, err),
  error: (msg: string, err?: unknown) => write('error', msg, err),
};

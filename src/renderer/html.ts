/** Escape a value for safe use inside HTML text or a quoted attribute. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** The save's file name, without its folder. */
export function saveFileName(filePath: string): string {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || 'Dynasty save';
}

/** "1 season" / "2 seasons" style pluralisation (suffix only). */
export function plural(count: number, suffix = 's'): string {
  return count === 1 ? '' : suffix;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function byName<T extends { displayName: string }>(a: T, b: T): number {
  return a.displayName.localeCompare(b.displayName);
}

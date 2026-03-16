/**
 * Strip HTML tags from a string to prevent XSS attacks.
 * Removes all < ... > patterns and trims the result.
 */
export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

/**
 * Sanitize all string fields in an object (shallow, one level).
 * Skips null/undefined values and non-string types.
 * Optionally skip specific keys (e.g., 'password', 'passwordHash').
 */
export function sanitizeStrings<T extends Record<string, any>>(
  obj: T,
  skipKeys: string[] = [],
): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (skipKeys.includes(key)) continue;
    if (typeof result[key] === 'string') {
      (result as any)[key] = stripHtml(result[key]);
    }
  }
  return result;
}

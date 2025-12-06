/**
 * Parse a rest time string into seconds
 * Handles formats like: "90 sec", "1:30", "2 min", "60", "90s", "1.5 min"
 * @param restString - The rest time string to parse
 * @param defaultSeconds - Default value if parsing fails (default: 60)
 * @returns Number of seconds
 */
export function parseRestTime(restString: string | undefined, defaultSeconds = 60): number {
  if (!restString || restString.trim() === '') {
    return defaultSeconds;
  }

  const normalized = restString.toLowerCase().trim();

  // Format: "1:30" or "01:30" (minutes:seconds)
  const colonMatch = normalized.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) {
    const minutes = parseInt(colonMatch[1], 10);
    const seconds = parseInt(colonMatch[2], 10);
    return minutes * 60 + seconds;
  }

  // Format: "2 min", "2min", "2 minutes", "1.5 min"
  const minMatch = normalized.match(/^([\d.]+)\s*min(ute)?s?$/);
  if (minMatch) {
    const minutes = parseFloat(minMatch[1]);
    return Math.round(minutes * 60);
  }

  // Format: "90 sec", "90sec", "90 seconds", "90s"
  const secMatch = normalized.match(/^(\d+)\s*s(ec(ond)?s?)?$/);
  if (secMatch) {
    return parseInt(secMatch[1], 10);
  }

  // Format: plain number "60", "90"
  const plainNumber = parseInt(normalized, 10);
  if (!isNaN(plainNumber) && plainNumber > 0) {
    return plainNumber;
  }

  return defaultSeconds;
}

/**
 * Format seconds into mm:ss display format
 * @param seconds - Total seconds
 * @returns Formatted string like "01:30"
 */
export function formatRestTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

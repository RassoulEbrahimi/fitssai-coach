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
 * Format seconds into display format
 * Shows only seconds (e.g., "45") if under 60 seconds
 * Shows mm:ss (e.g., "01:30") if 60 seconds or more
 * @param seconds - Total seconds
 * @returns Formatted string
 */
export function formatRestTime(seconds: number): string {
  if (seconds < 60) {
    return seconds.toString();
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format a stored rest value for display, in one consistent convention.
 *
 * Stored values are inconsistent ("90 sec", "1:30", "60", "90s"), so the raw
 * value is normalised through parseRestTime first and always rendered in
 * seconds: "90 s", or "90 s Pause" when the label is needed for context.
 *
 * @param rest - Raw stored rest value
 * @param options.withLabel - Append the German "Pause" label
 * @returns Formatted string, or an empty string when there is no rest value
 */
export function formatRestDisplay(
  rest: string | undefined,
  options: { withLabel?: boolean } = {}
): string {
  if (!rest || rest.trim() === '') {
    return '';
  }
  const seconds = parseRestTime(rest, 0);
  if (seconds <= 0) {
    return '';
  }
  return options.withLabel ? `${seconds} s Pause` : `${seconds} s`;
}

/**
 * Screen-reader text for a running rest countdown.
 *
 * Announcing every tick would produce a second-by-second stream, so only the
 * milestones that matter are voiced: 30s, 10s and the end of the pause.
 * Returns null for every other second, which keeps the live region silent.
 */
export function getRestAnnouncement(
  remainingSeconds: number,
  isComplete: boolean
): string | null {
  if (isComplete || remainingSeconds === 0) return 'Pause beendet';
  if (remainingSeconds === 30) return '30 Sekunden Pause verbleibend';
  if (remainingSeconds === 10) return '10 Sekunden Pause verbleibend';
  return null;
}

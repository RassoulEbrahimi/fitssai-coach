import { describe, expect, it } from 'vitest';

/**
 * P1-08 — the motivation card must not tell anyone to keep training in pain.
 *
 * Home renders one quote from `gogginsQuotes` on mount and re-draws from the
 * same array when the refresh button is pressed, so every string in that array
 * is a line the product is willing to show a user who is about to train. The
 * pool contained "Don't stop when you feel pain. Stop when you're finished." —
 * read next to today's session, that is an instruction to train through pain.
 *
 * This suite reads the exported pool the render path indexes, not a copy, so a
 * quote re-added later fails here rather than reaching the dashboard.
 */

import { gogginsQuotes } from '@/views/HomeView';

/** The exact line the audit found. Kept verbatim so it can never come back. */
const AUDIT_QUOTE = "Don't stop when you feel pain. Stop when you're finished.";

/*
  The prohibited semantic pattern, not a blocklist of strings: guidance to
  continue exercising through pain or injury. Each entry stays sentence-local
  ([^.]* never crosses a full stop) so an unrelated clause elsewhere in a long
  quote cannot trip it.
*/
const UNSAFE_PAIN_GUIDANCE: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'tells the reader not to stop for pain',
    pattern: /(don'?t|do not|never)\s+stop[^.]*\bpain\b/i,
  },
  {
    label: 'tells the reader to ignore or suppress pain',
    pattern: /\b(ignore|ignoring|silence|numb)\b[^.]*\b(pain|injur\w*)\b/i,
  },
  {
    label: 'tells the reader to push, train or work through pain or injury',
    pattern: /\b(push|train|work|fight|power|grind|callus\w*)\w*\b[^.]*\bthrough\b[^.]*\b(pain|injur\w*|suffering)\b/i,
  },
  {
    label: 'frames pain or injury as the route to progress',
    pattern: /\bpain\b[^.]*\b(unlocks?|leads? to|is|means|equals)\b[^.]*\b(gain|progress|growth|peak performance|potential|greatness|strength)\b/i,
  },
  {
    label: 'the "no pain, no gain" formula',
    pattern: /no\s+pain\b[^.]*\bno\s+gain/i,
  },
  {
    label: 'tells the reader to continue despite pain or injury',
    pattern: /\b(despite|regardless of)\b[^.]*\b(pain|injur\w*)\b/i,
  },
];

const offences = (quote: string) =>
  UNSAFE_PAIN_GUIDANCE.filter(({ pattern }) => pattern.test(quote)).map(({ label }) => label);

describe('motivation quote pool — content safety', () => {
  it('does not contain the quote the audit found', () => {
    expect(gogginsQuotes).not.toContain(AUDIT_QUOTE);
  });

  it('contains no guidance to keep exercising through pain or injury', () => {
    const flagged = gogginsQuotes
      .filter(quote => offences(quote).length > 0)
      .map(quote => `${quote} — ${offences(quote).join('; ')}`);

    expect(flagged).toEqual([]);
  });

  /*
    A guard whose patterns match nothing would pass the test above while
    catching nothing. This pins the patterns to the content they exist for: if
    a refactor neuters them, this fails first.
  */
  it('has a guard that still recognises the removed guidance', () => {
    expect(offences(AUDIT_QUOTE)).not.toEqual([]);
    expect(offences('Callus your mind through pain and suffering.')).not.toEqual([]);
    expect(offences('Pain unlocks a secret doorway that leads to peak performance.')).not.toEqual([]);
    expect(offences('No pain, no gain.')).not.toEqual([]);
  });

  it('still has valid quotes for the card to render', () => {
    expect(gogginsQuotes.length).toBeGreaterThan(0);

    for (const quote of gogginsQuotes) {
      expect(typeof quote).toBe('string');
      expect(quote.trim()).not.toBe('');
      expect(quote).toBe(quote.trim());
    }

    expect(new Set(gogginsQuotes).size).toBe(gogginsQuotes.length);
  });
});

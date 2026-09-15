import { describe, expect, it } from 'vitest';
import { exercisePresentations } from '@/lib/exercisePresentation';

/** The shipped artwork, read as text so the files themselves can be checked. */
const assets = import.meta.glob('/src/assets/exercise-thumbnails/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const basename = (path: string) => path.split('/').pop()!;
const files = Object.keys(assets).map(basename).sort();
const entries = Object.entries(assets).map(([path, markup]) => [basename(path), markup] as const);

/* An <img> never runs SVG script, but the pack must also be safe to inline or
   to open directly, and it must not reach the network. */
const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ['script', /<script/i],
  ['foreign object', /<foreignObject/i],
  ['raster or nested image', /<image[\s>]/i],
  ['external reference', /\shref=|xlink:/i],
  ['url() reference', /url\(/i],
  ['embedded data URI', /data:/i],
  ['event handler', /\son[a-z]+=/i],
  ['text', /<text[\s>]/i],
];

describe('exercise thumbnail assets', () => {
  it('ships one kebab-case SVG per canonical movement', () => {
    expect(files.length).toBe(exercisePresentations.length);
    for (const file of files) expect(file).toMatch(/^[a-z0-9-]+\.svg$/);
  });

  it.each(entries)('%s is a 72x72 vector with a transparent background', (_file, markup) => {
    expect(markup).toContain('viewBox="0 0 72 72"');
    expect(markup).not.toMatch(/<rect[^>]*width="72"[^>]*height="72"/);
  });

  it.each(entries)('%s contains no script, external resource or raster payload', (_file, markup) => {
    for (const [label, pattern] of FORBIDDEN) {
      expect(`${label}: ${pattern.test(markup)}`).toBe(`${label}: false`);
    }
  });

  it.each(entries)('%s stays small enough to bundle', (_file, markup) => {
    expect(markup.length).toBeLessThanOrEqual(1536);
  });

  it('is referenced exactly once each, with no orphans', () => {
    const referenced = exercisePresentations.map(entry => basename(entry.thumbnail!.src));
    expect(new Set(referenced).size).toBe(referenced.length);
    expect([...referenced].sort()).toEqual(files);
  });
});

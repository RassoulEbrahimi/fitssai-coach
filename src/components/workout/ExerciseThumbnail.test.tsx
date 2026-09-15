import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ExerciseThumbnail from './ExerciseThumbnail';

describe('ExerciseThumbnail', () => {
  it('reserves dimensions for a lazy decorative local image', () => {
    const { container } = render(<ExerciseThumbnail name="Bankdrücken" />);
    const surface = container.querySelector('[data-exercise-thumbnail]');
    expect(surface).toHaveAttribute('aria-hidden', 'true');
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('width', '72');
    expect(image).toHaveAttribute('height', '72');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('alt', '');
    expect(image?.getAttribute('src')).toContain('bench-press.svg');
  });

  it('inverts the light-surface artwork in dark mode instead of shipping a second file', () => {
    const { container } = render(<ExerciseThumbnail name="Kniebeugen" />);
    const image = container.querySelector('img');
    expect(image?.className).toContain('dark:invert');
    expect(image?.className).toContain('dark:hue-rotate-180');
  });

  it('renders identity-specific graphics for exercises outside the registry', () => {
    const { container, rerender } = render(<ExerciseThumbnail name="Brustpresse Maschine" />);
    expect(container).toHaveTextContent('BM');
    const first = container.innerHTML;
    rerender(<ExerciseThumbnail name="Seilzug Crunch Kniend" />);
    expect(container).toHaveTextContent('SCK');
    expect(container.innerHTML).not.toBe(first);
    expect(container.querySelector('img')).toBeNull();
  });

  it('replaces a broken image without removing or resizing its surface', () => {
    const { container, rerender } = render(<ExerciseThumbnail name="Bankdrücken" />);
    const surface = container.querySelector('[data-exercise-thumbnail]');
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('BA');
    expect(container.querySelector('[data-exercise-thumbnail]')).toBe(surface);
    rerender(<ExerciseThumbnail name="Plank" />);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('plank.svg');
  });
});

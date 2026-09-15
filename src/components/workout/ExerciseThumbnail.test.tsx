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
  });

  it('renders identity-specific graphics for unknown exercises', () => {
    const { container, rerender } = render(<ExerciseThumbnail name="Trizepsstrecken Kabelzug Kordel" />);
    expect(container).toHaveTextContent('TKK');
    const first = container.innerHTML;
    rerender(<ExerciseThumbnail name="Beinpresse 45° Plate Loaded" />);
    expect(container).toHaveTextContent('B4P');
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
    expect(container).toHaveTextContent('PL');
  });
});

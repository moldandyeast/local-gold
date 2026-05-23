import { describe, it, expect } from 'vitest';
import { arrowhead } from '../src/renderer/shapes';

describe('arrowhead', () => {
  it('places both head points at distance `size` from the tip', () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 10, y: 0 }, 5);
    expect(Math.hypot(head.left.x - 10, head.left.y)).toBeCloseTo(5);
    expect(Math.hypot(head.right.x - 10, head.right.y)).toBeCloseTo(5);
  });

  it('places head points symmetric across the line', () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 10, y: 0 }, 5);
    expect(head.left.x).toBeCloseTo(head.right.x);
    expect(head.left.y).toBeCloseTo(-head.right.y);
  });

  it('handles a vertical line', () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 0, y: 10 }, 5);
    expect(Math.hypot(head.left.x, head.left.y - 10)).toBeCloseTo(5);
    expect(Math.hypot(head.right.x, head.right.y - 10)).toBeCloseTo(5);
  });
});

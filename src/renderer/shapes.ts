export interface Point {
  x: number;
  y: number;
}

/** A drawn annotation shape on the canvas. */
export interface Shape {
  tool: 'pen' | 'arrow' | 'rect';
  /** Pen: every captured point. Arrow / rect: [start, end]. */
  points: Point[];
}

/** Two endpoints of an arrowhead at `b`, swept back along the line from a → b. */
export function arrowhead(
  a: Point,
  b: Point,
  size: number
): { left: Point; right: Point } {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const spread = Math.PI / 6;
  return {
    left: {
      x: b.x - size * Math.cos(angle - spread),
      y: b.y - size * Math.sin(angle - spread)
    },
    right: {
      x: b.x - size * Math.cos(angle + spread),
      y: b.y - size * Math.sin(angle + spread)
    }
  };
}

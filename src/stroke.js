import { clamp } from './level.js';

export function makeStroke(start, end, tolerance, level) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  const fraction = dist > 0 ? Math.min(1, level.strokeLimit / dist) : 1;
  return {
    start: { x: start.x, y: start.y },
    end: { x: start.x + dx * fraction, y: start.y + dy * fraction },
    tolerance,
    capped: dist >= level.strokeLimit - 0.5
  };
}

function intersectsRect(start, end, rect) {
  let from = 0;
  let to = 1;
  for (const [position, delta, low, high] of [
    [start.x, end.x - start.x, rect.x, rect.x + rect.width],
    [start.y, end.y - start.y, rect.y, rect.y + rect.height]
  ]) {
    if (Math.abs(delta) < 1e-5) {
      if (position < low || position > high) return false;
      continue;
    }
    const first = (low - position) / delta;
    const last = (high - position) / delta;
    from = Math.max(from, Math.min(first, last));
    to = Math.min(to, Math.max(first, last));
  }
  return from <= to;
}

export function hitTest(stroke, level, state = null) {
  const { start, end, tolerance } = stroke;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  return {
    pins: level.pins.map((pin, i) => {
      if (state && !state.attached[i]) return false;
      const t = clamp(((pin.x - start.x) * dx + (pin.y - start.y) * dy) / lengthSquared, 0, 1);
      return Math.hypot(pin.x - start.x - t * dx, pin.y - start.y - t * dy) <= tolerance;
    }),
    rooms: level.rooms.map((room, i) => {
      if (state && !state.roomsAlive[i]) return false;
      return intersectsRect(start, end, room);
    })
  };
}

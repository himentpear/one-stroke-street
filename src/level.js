export const level = {
  width: 600, height: 328, floor: 309, gravity: 580,
  strokeLimit: 144, ballRadius: 14, roomWidth: 68, roomHeight: 41,
  pins: [{ x: 96, y: 73 }, { x: 192, y: 73 }],
  rooms: [{ x: 198, y: 147 }, { x: 206, y: 198 }, { x: 437, y: 173 }, { x: 458, y: 224 }],
  spring: { left: 207, right: 298, top: 273, vx: 218, vy: -370 }
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function makeStroke(start, end, tolerance) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const fraction = Math.min(1, level.strokeLimit / (Math.hypot(dx, dy) || 1));
  return { start, end: { x: start.x + dx * fraction, y: start.y + dy * fraction }, tolerance };
}

function intersectsRoom(start, end, room) {
  let from = 0, to = 1;
  for (const [position, delta, low, high] of [
    [start.x, end.x - start.x, room.x, room.x + level.roomWidth],
    [start.y, end.y - start.y, room.y, room.y + level.roomHeight]
  ]) {
    if (Math.abs(delta) < .00001) {
      if (position < low || position > high) return false;
      continue;
    }
    const first = (low - position) / delta, last = (high - position) / delta;
    from = Math.max(from, Math.min(first, last));
    to = Math.min(to, Math.max(first, last));
  }
  return from <= to;
}

export function hitTest({ start, end, tolerance }) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  return {
    pins: level.pins.map(p => {
      const t = clamp(((p.x - start.x) * dx + (p.y - start.y) * dy) / lengthSquared, 0, 1);
      return Math.hypot(p.x - start.x - t * dx, p.y - start.y - t * dy) <= tolerance;
    }),
    rooms: level.rooms.map(room => intersectsRoom(start, end, room))
  };
}

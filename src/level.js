export const defaultLevel = {
  id: 'bowling-alley-last-order',
  title: '保龄球馆的最后一单',
  subtitle: '用一笔拆完街两边的四间亮房。',
  width: 600,
  height: 328,
  floor: 309,
  scale: 32,
  gravity: 18.5,
  maxStrokes: 1,
  strokeLimit: 144,
  awning: {
    x: 96,
    y: 73,
    width: 96,
    height: 11,
    density: 1.6,
    friction: 0.42,
    restitution: 0.14,
    maxTilt: 0.49
  },
  pins: [
    { id: 'pin-left', side: 'left', x: 96, y: 73, radius: 10 },
    { id: 'pin-right', side: 'right', x: 192, y: 73, radius: 10 }
  ],
  ball: {
    id: 'ball',
    x: 144,
    y: 53.5,
    radius: 14,
    density: 8.5,
    friction: 0.45,
    restitution: 0.28,
    angularDamping: 0.08
  },
  rooms: [
    { id: 'room-0', x: 198, y: 147, width: 68, height: 41, density: 0.45, breakImpulse: 1.4, roofId: 'roof-0' },
    { id: 'room-1', x: 206, y: 198, width: 68, height: 41, density: 0.45, breakImpulse: 1.4, roofId: null },
    { id: 'room-2', x: 437, y: 173, width: 68, height: 41, density: 0.45, breakImpulse: 1.2, roofId: 'roof-1' },
    { id: 'room-3', x: 458, y: 224, width: 68, height: 41, density: 0.45, breakImpulse: 1.2, roofId: null }
  ],
  roofs: [
    { id: 'roof-0', supportRoomId: 'room-0', x: 232, y: 138, width: 76, height: 16, density: 1.5 },
    { id: 'roof-1', supportRoomId: 'room-2', x: 471, y: 164, width: 76, height: 16, density: 1.5 }
  ],
  spring: {
    id: 'spring',
    left: 207,
    right: 298,
    top: 273,
    thickness: 8,
    baseY: 298,
    launchVx: 7.4,
    launchVy: -11.9,
    minMass: 0.6
  },
  staticBlocks: [
    // Left tower wall (guides left-cut ball into left alley & forms left edge of central well)
    { id: 'left-tower', x: 53, y: 122, width: 39, height: 187 },
    // Right shop plinth under right rooms
    { id: 'right-base', x: 419, y: 276, width: 112, height: 33 }
  ]
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function cloneLevel(overrides = null) {
  const copy = JSON.parse(JSON.stringify(defaultLevel));
  if (!overrides) return copy;
  if (overrides.spring) Object.assign(copy.spring, overrides.spring);
  if (overrides.ball) Object.assign(copy.ball, overrides.ball);
  if (overrides.awning) Object.assign(copy.awning, overrides.awning);
  if (typeof overrides.gravity === 'number') copy.gravity = overrides.gravity;
  if (typeof overrides.strokeLimit === 'number') copy.strokeLimit = overrides.strokeLimit;
  if (Array.isArray(overrides.rooms)) {
    overrides.rooms.forEach((patch, idx) => {
      if (patch && copy.rooms[idx]) Object.assign(copy.rooms[idx], patch);
    });
  }
  return copy;
}

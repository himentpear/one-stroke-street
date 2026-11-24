import { level } from './level.js';

const svgNode = name => document.createElementNS('http://www.w3.org/2000/svg', name);
const translate = (x, y) => 'translate(' + x + ' ' + y + ')';
const place = (node, x, y, angle = 0) => node.setAttribute('transform', translate(x, y) + ' rotate(' + angle + ')');
const show = (node, visible) => node.setAttribute('visibility', visible ? 'visible' : 'hidden');

export function createView(root) {
  const get = name => root.querySelector('[data-' + name + ']');
  const pins = [...root.querySelectorAll('[data-pin]')];
  const roofNodes = [...get('roofs').children];
  const debrisGroup = get('splinters'), awning = get('awning'), ball = get('ball'), trail = get('trail');
  const spring = get('spring-top'), coils = get('coils'), pencil = get('pencil');
  const lines = [...pencil.querySelectorAll('line')];
  const rooms = level.rooms.map(room => {
    const node = svgNode('use');
    node.setAttribute('href', '#oss-room');
    place(node, room.x, room.y);
    get('rooms').append(node);
    return node;
  });
  let pieces = [], rings = [];

  function clearStroke() {
    show(pencil, false);
    for (const node of [...pins, ...rooms]) node.classList.remove('stroke-hit');
  }
  function preview(stroke, hits) {
    pins.forEach((node, i) => node.classList.toggle('stroke-hit', hits.pins[i]));
    rooms.forEach((node, i) => node.classList.toggle('stroke-hit', hits.rooms[i]));
    for (const line of lines) {
      line.setAttribute('x1', stroke.start.x);
      line.setAttribute('y1', stroke.start.y);
      line.setAttribute('x2', stroke.end.x);
      line.setAttribute('y2', stroke.end.y);
    }
    show(pencil, true);
  }
  function reset() {
    clearStroke();
    debrisGroup.replaceChildren();
    rings = [];
    pieces = [0, 2].map((support, i) => ({
      node: roofNodes[i], support, x: level.rooms[support].x + 34, y: level.rooms[support].y - 9,
      vx: i ? 32 : -35, vy: 0, angle: 0, turn: i ? 65 : -75, halfWidth: 39, halfHeight: 10
    }));
  }
  function crumble(index, time) {
    const room = level.rooms[index];
    const ring = svgNode('circle');
    ring.setAttribute('cx', room.x + 34);
    ring.setAttribute('cy', room.y + 20);
    ring.setAttribute('class', 'impact-ring');
    debrisGroup.append(ring);
    rings.push({ node: ring, time });
    for (let i = 0; i < 6; i++) {
      const large = i === 1 || i === 4;
      const node = svgNode('path');
      node.setAttribute('d', large ? 'M-12-7H12V2L6-1L2 6H-12Z' : 'M-5-2H5L3 2H-5Z');
      node.setAttribute('class', large ? 'shard large' : 'shard');
      debrisGroup.append(node);
      pieces.push({ node, x: room.x + 7 + i * 10, y: room.y + 19, vx: (i - 2.5) * 26,
        vy: -48 - (i * 17) % 63, angle: i * 11, turn: (i - 2.5) * 85,
        halfWidth: large ? 12 : 5, halfHeight: large ? 7 : 2 });
    }
  }
  function stepEffects(dt, state) {
    for (const p of pieces) {
      if (p.landed || state.rooms[p.support]) continue;
      p.vy += level.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.turn * dt;
      const angle = p.angle * Math.PI / 180;
      const bottom = Math.abs(Math.sin(angle)) * p.halfWidth + Math.abs(Math.cos(angle)) * p.halfHeight;
      if (p.y + bottom >= level.floor) { p.y = level.floor - bottom; p.landed = true; }
    }
  }
  function draw(state) {
    const deg = 180 / Math.PI;
    place(awning, state.shelf.x, state.shelf.y, state.shelf.tilt * deg);
    place(ball, state.ball.x, state.ball.y, state.ball.spin * deg);
    rooms.forEach((node, i) => show(node, state.rooms[i]));
    pins.forEach((node, i) => show(node, state.attached[i]));
    const compression = state.springTime === null ? 0 : 8 + 5 * Math.exp(-8 * (state.time - state.springTime));
    spring.setAttribute('transform', translate(0, compression));
    coils.setAttribute('transform', 'translate(0 298) scale(1 ' + (1 - compression / 24) + ') translate(0 -298)');
    trail.setAttribute('points', state.trail.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' '));
    pieces.forEach(p => place(p.node, p.x, p.y, p.angle));
    for (const ring of rings) {
      const progress = Math.min(1, (state.time - ring.time) / .21);
      ring.node.setAttribute('r', 6 + 35 * progress);
      ring.node.setAttribute('opacity', .65 * (1 - progress));
    }
  }
  return { reset, clearStroke, preview, crumble, stepEffects, draw };
}

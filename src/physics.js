import { clamp, level } from './level.js';

export const timeStep = 1 / 120;
const [leftPin, rightPin] = level.pins;
const shelfWidth = rightPin.x - leftPin.x;
const radius = level.ballRadius;

export function newRound() {
  return {
    phase: 'ready', time: 0, frames: 0, quiet: 0, impactPause: 0, smashed: 0,
    attached: [true, true], rooms: level.rooms.map(() => true), events: [],
    shelf: { x: leftPin.x, y: leftPin.y, tilt: 0, turnSpeed: 0, fallSpeed: 0 },
    ball: { x: leftPin.x + shelfWidth / 2, y: leftPin.y - radius, vx: 0, vy: 0,
      spin: 0, mode: 'shelf', along: shelfWidth / 2, speed: 0 },
    springTime: null, trail: []
  };
}

function breakRoom(state, index) {
  if (!state.rooms[index]) return;
  state.rooms[index] = false;
  state.smashed++;
  state.impactPause = state.smashed === level.rooms.length ? .085 : .035;
  state.events.push({ type: 'break', index, count: state.smashed });
}

export function applyCut(state, hits) {
  if (state.phase !== 'ready' || !(hits.pins.some(Boolean) || hits.rooms.some(Boolean))) return false;
  state.phase = 'moving';
  state.attached = hits.pins.map(hit => !hit);
  state.trail.push({ x: state.ball.x, y: state.ball.y });
  hits.rooms.forEach((hit, i) => { if (hit) breakRoom(state, i); });
  return true;
}

function moveShelf(state, dt) {
  const shelf = state.shelf;
  const [left, right] = state.attached;
  if (!left && !right) {
    shelf.fallSpeed += level.gravity * dt;
    shelf.y = Math.min(level.floor - 13, shelf.y + shelf.fallSpeed * dt);
  } else if (left !== right) {
    shelf.turnSpeed += 5.4 * dt;
    shelf.tilt = clamp(shelf.tilt + (left ? 1 : -1) * shelf.turnSpeed * dt, -.49, .49);
    if (right) {
      shelf.x = rightPin.x - shelfWidth * Math.cos(shelf.tilt);
      shelf.y = rightPin.y - shelfWidth * Math.sin(shelf.tilt);
    }
  }
}

function moveBall(state, dt) {
  const ball = state.ball, shelf = state.shelf;
  if (ball.mode === 'shelf') {
    const sin = Math.sin(shelf.tilt), cos = Math.cos(shelf.tilt);
    ball.speed += level.gravity * sin * .74 * dt;
    ball.along += ball.speed * dt;
    ball.spin += ball.speed * dt / radius;
    ball.x = shelf.x + ball.along * cos + radius * sin;
    ball.y = shelf.y + ball.along * sin - radius * cos;
    if (ball.along < 0 || ball.along > shelfWidth) {
      ball.mode = 'air';
      ball.vx = ball.speed * cos;
      ball.vy = ball.speed * sin;
    }
    return;
  }
  if (ball.mode === 'ground') {
    ball.x = clamp(ball.x + ball.vx * dt, radius, level.width - radius);
    ball.spin += ball.vx * dt / radius;
    ball.vx *= Math.exp(-7 * dt);
    return;
  }
  const oldBottom = ball.y + radius;
  ball.vy += level.gravity * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.spin += ball.vx * dt / radius;
  if (ball.x < radius || ball.x > level.width - radius) {
    ball.x = clamp(ball.x, radius, level.width - radius);
    ball.vx *= -.2;
  }
  level.rooms.forEach((room, i) => {
    if (!state.rooms[i]) return;
    const nearX = clamp(ball.x, room.x, room.x + level.roomWidth);
    const nearY = clamp(ball.y, room.y, room.y + level.roomHeight);
    if (Math.hypot(ball.x - nearX, ball.y - nearY) <= radius) breakRoom(state, i);
  });
  const spring = level.spring;
  if (state.springTime === null && oldBottom <= spring.top && ball.y + radius >= spring.top &&
      ball.x >= spring.left && ball.x <= spring.right) {
    state.springTime = state.time;
    ball.y = spring.top - radius;
    ball.vx = spring.vx;
    ball.vy = spring.vy;
    state.events.push({ type: 'spring' });
  }
  if (ball.y + radius >= level.floor) {
    ball.y = level.floor - radius;
    ball.mode = 'ground';
    state.events.push({ type: 'land' });
  }
}

export function advance(state) {
  if (state.phase !== 'moving') return;
  if (state.impactPause > 0) { state.impactPause -= timeStep; return; }
  state.time += timeStep;
  state.frames++;
  moveShelf(state, timeStep);
  moveBall(state, timeStep);
  const ball = state.ball;
  if (state.frames % 5 === 0) {
    const last = state.trail[state.trail.length - 1];
    if (!last || Math.hypot(ball.x - last.x, ball.y - last.y) > 3) state.trail.push({ x: ball.x, y: ball.y });
  }
  const steady = (ball.mode === 'ground' && Math.abs(ball.vx) < 5) ||
    (ball.mode === 'shelf' && (state.attached.every(Boolean) || state.shelf.y >= level.floor - 13));
  state.quiet = steady ? state.quiet + timeStep : 0;
  if (state.quiet > .85 || state.time > 6) state.phase = 'done';
}

import { clamp, cloneLevel } from './level.js';
import { hitTest, makeStroke } from './stroke.js';
import { createPhysicsWorld, timeStep } from './physics.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const root = document.querySelector('main');
const canvas = root.querySelector('[data-board]');
const remaining = root.querySelector('[data-strokes]');
const cleared = root.querySelector('[data-cleared]');
const status = root.querySelector('[data-outcome]');
const retry = root.querySelector('[data-reset]');
const debugButton = root.querySelector('[data-debug]');
const choices = [...root.querySelectorAll('[data-trial]')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const renderer = createRenderer(canvas);
const sound = createAudio(document.querySelector('[data-sound]'));

let levelOverrides = null;
let level = cloneLevel(levelOverrides);
let sim = null;
let drag = null;
let frame = 0;
let previousTime = 0;
let accumulator = 0;

if (new URLSearchParams(location.search).get('debug') === '1') {
  renderer.setDebug(true);
  if (debugButton) debugButton.setAttribute('aria-pressed', 'true');
}

function consumeEvents(audible) {
  const reduced = reducedMotion.matches;
  for (const event of sim.state.events) {
    renderer.handleEvent(event, reduced);
    if (event.type === 'break') {
      cleared.textContent = String(event.count);
      if (!reduced) {
        cleared.classList.remove('score-pop');
        void cleared.offsetWidth;
        cleared.classList.add('score-pop');
      }
    }
    if (audible) sound(event);
  }
  sim.state.events.length = 0;
}

function reset(overrides = levelOverrides) {
  cancelAnimationFrame(frame);
  frame = 0;
  if (drag && canvas.hasPointerCapture(drag.id)) {
    canvas.releasePointerCapture(drag.id);
  }
  drag = null;
  levelOverrides = overrides;
  level = cloneLevel(levelOverrides);
  sim = createPhysicsWorld(level);
  renderer.resetFX();
  renderer.render(sim.state, 1);

  root.dataset.phase = 'ready';
  delete root.dataset.clearedAll;
  remaining.textContent = String(level.maxStrokes);
  cleared.textContent = '0';
  cleared.classList.remove('score-pop');
  status.textContent = '划过圆扣或亮窗，松手拆除。';
  retry.disabled = true;
  choices.forEach(button => { button.disabled = false; });
}

function finish() {
  root.dataset.phase = 'done';
  const allCleared = sim.state.smashed === level.rooms.length;
  root.dataset.clearedAll = String(allCleared);
  if (allCleared) status.textContent = '全街打烊！一笔拆完四间亮房。';
  else if (sim.state.attached.every(pin => !pin)) status.textContent = '两扣齐断，雨棚托着球平落进空井。';
  else if (!sim.state.attached[0]) status.textContent = '球滚进了左侧空巷。换一处落笔试试。';
  else status.textContent = '这一笔拆了 ' + sim.state.smashed + ' 间。重画再试。';
}

function animate(now) {
  const frameDt = Math.min(Math.max((now - previousTime) / 1000, 0), 0.05);
  previousTime = now;

  // Hit-stop pauses physics for ~80ms and discards backlog so normal speed resumes cleanly
  if (sim.state.hitStop > 0) {
    sim.state.hitStop = Math.max(0, sim.state.hitStop - frameDt);
    accumulator = 0;
    renderer.render(sim.state, 1);
    frame = requestAnimationFrame(animate);
    return;
  }

  accumulator += frameDt;
  const maxSteps = 8;
  let stepsRun = 0;
  while (accumulator >= timeStep && sim.state.phase === 'moving' && stepsRun < maxSteps) {
    sim.step();
    consumeEvents(true);
    renderer.stepFX(timeStep, level, reducedMotion.matches);
    accumulator -= timeStep;
    stepsRun++;
    if (sim.state.hitStop > 0) {
      accumulator = 0;
      break;
    }
  }

  const alpha = sim.state.phase === 'moving' ? clamp(accumulator / timeStep, 0, 1) : 1;
  renderer.render(sim.state, alpha);
  if (sim.state.phase === 'moving') {
    frame = requestAnimationFrame(animate);
  } else {
    frame = 0;
    finish();
  }
}

function submit(stroke) {
  renderer.clearPreview();
  const hits = hitTest(stroke, level, sim.state);
  if (!sim.applyCut(hits)) {
    renderer.render(sim.state, 1);
    status.textContent = '划空了，仍有一笔。试着穿过圆扣或亮窗。';
    return;
  }

  choices.forEach(button => { button.disabled = true; });
  retry.disabled = false;
  remaining.textContent = '0';
  root.dataset.phase = 'moving';
  status.textContent = '已落笔，看看球会滚向哪里。';
  renderer.flashCut(stroke, reducedMotion.matches);
  consumeEvents(true);
  renderer.render(sim.state, 1);

  accumulator = 0;
  previousTime = performance.now();
  frame = requestAnimationFrame(animate);
}

function strokeAt(event) {
  return makeStroke(drag.start, renderer.screenToWorld(event.clientX, event.clientY, level), drag.tolerance, level);
}

canvas.addEventListener('pointerdown', event => {
  if (drag || sim.state.phase !== 'ready' || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  const tolerance = event.pointerType === 'touch' ? clamp(22 / renderer.getScale(), 12, 44) : 12;
  drag = { id: event.pointerId, start: renderer.screenToWorld(event.clientX, event.clientY, level), tolerance };
  canvas.setPointerCapture(event.pointerId);
  const stroke = strokeAt(event);
  renderer.setPreview(stroke, hitTest(stroke, level, sim.state));
  renderer.render(sim.state, 1);
});

canvas.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId) return;
  const stroke = strokeAt(event);
  renderer.setPreview(stroke, hitTest(stroke, level, sim.state));
  renderer.render(sim.state, 1);
});

canvas.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  const stroke = strokeAt(event);
  drag = null;
  if (Math.hypot(stroke.end.x - stroke.start.x, stroke.end.y - stroke.start.y) < 3) {
    renderer.clearPreview();
    renderer.render(sim.state, 1);
  } else {
    submit(stroke);
  }
});

function cancelDrag(event) {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  renderer.clearPreview();
  renderer.render(sim.state, 1);
}

canvas.addEventListener('pointercancel', cancelDrag);
canvas.addEventListener('lostpointercapture', cancelDrag);
canvas.addEventListener('dragstart', event => event.preventDefault());

retry.addEventListener('click', () => reset());

choices.forEach(button => button.addEventListener('click', () => {
  const option = button.dataset.trial;
  const x = level.pins[option === 'right' ? 1 : 0].x;
  const endX = option === 'both' ? level.pins[1].x : x;
  submit(makeStroke({ x, y: 62 }, { x: endX, y: 84 }, 12, level));
}));

if (debugButton) {
  debugButton.addEventListener('click', () => {
    const next = !renderer.getDebug();
    renderer.setDebug(next);
    debugButton.setAttribute('aria-pressed', String(next));
    renderer.render(sim.state, 1);
  });
}

window.addEventListener('keydown', event => {
  if (event.key === 'd' || event.key === 'D') {
    if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
    const next = !renderer.getDebug();
    renderer.setDebug(next);
    if (debugButton) debugButton.setAttribute('aria-pressed', String(next));
    renderer.render(sim.state, 1);
  }
});

window.addEventListener('resize', () => {
  if (sim) renderer.render(sim.state, 1);
});

// Expose structured inspection & debug tuning hooks
window.__OSS__ = {
  worldToScreen: (x, y) => renderer.worldToScreen(x, y, level),
  setDebug: enabled => {
    renderer.setDebug(enabled);
    if (debugButton) debugButton.setAttribute('aria-pressed', String(Boolean(enabled)));
    renderer.render(sim.state, 1);
  },
  setLevelOverrides: overrides => reset(overrides),
  getSnapshot: () => {
    const ball = sim.state.bodies.get('ball')?.curr || null;
    const awning = sim.state.bodies.get('awning')?.curr || null;
    return {
      phase: sim.state.phase,
      time: sim.state.time,
      smashed: sim.state.smashed,
      remaining: Number(remaining.textContent),
      attached: [...sim.state.attached],
      springStatus: sim.state.spring.status,
      springCompression: sim.state.spring.compression,
      ball,
      awning,
      fractureOrder: sim.state.fractureOrder.map(f => f.id),
      fx: renderer.getFXCounts(),
      debug: renderer.getDebug(),
      previewActive: Boolean(drag)
    };
  }
};

reset();

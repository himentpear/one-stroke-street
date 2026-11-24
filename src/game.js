import { clamp, hitTest, level, makeStroke } from './level.js';
import { advance, applyCut, newRound, timeStep } from './physics.js';
import { createView } from './view.js';
import { createAudio } from './audio.js';

const root = document.querySelector('main');
const svg = root.querySelector('[data-board]');
const remaining = root.querySelector('[data-strokes]');
const cleared = root.querySelector('[data-cleared]');
const status = root.querySelector('[data-outcome]');
const retry = root.querySelector('[data-reset]');
const choices = [...root.querySelectorAll('[data-trial]')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const view = createView(root);
const sound = createAudio(document.querySelector('[data-sound]'));
let state, drag, frame, previousTime, accumulator;

function reset() {
  cancelAnimationFrame(frame);
  if (drag && svg.hasPointerCapture(drag.id)) svg.releasePointerCapture(drag.id);
  drag = null;
  state = newRound();
  view.reset();
  view.draw(state);
  root.dataset.phase = 'ready';
  remaining.textContent = '1';
  cleared.textContent = '0';
  status.textContent = '划过圆扣或亮窗，松手拆除。';
  retry.disabled = true;
  choices.forEach(button => { button.disabled = false; });
}

function consumeEvents(audible) {
  for (const event of state.events) {
    if (event.type === 'break') {
      view.crumble(event.index, state.time);
      cleared.textContent = String(event.count);
    }
    if (audible) sound(event);
  }
  state.events.length = 0;
}
function step(audible) {
  const before = state.time;
  advance(state);
  consumeEvents(audible);
  if (state.time > before) view.stepEffects(timeStep, state);
}
function finish() {
  root.dataset.phase = 'done';
  if (state.smashed === level.rooms.length) status.textContent = '全街打烊！一笔拆完四间亮房。';
  else if (state.attached.every(pin => !pin)) status.textContent = '两扣齐断，雨棚托着球平落进空井。';
  else if (!state.attached[0]) status.textContent = '球滚进了左侧空巷。换一处落笔试试。';
  else status.textContent = '这一笔拆了 ' + state.smashed + ' 间。重画再试。';
}
function animate(now) {
  accumulator += Math.min((now - previousTime) / 1000, .06);
  previousTime = now;
  while (accumulator >= timeStep && state.phase === 'moving') {
    step(true);
    accumulator -= timeStep;
  }
  view.draw(state);
  if (state.phase === 'moving') frame = requestAnimationFrame(animate);
  else finish();
}
function submit(stroke) {
  view.clearStroke();
  if (!applyCut(state, hitTest(stroke))) {
    status.textContent = '划空了，仍有一笔。试着穿过圆扣或亮窗。';
    return;
  }
  choices.forEach(button => { button.disabled = true; });
  retry.disabled = false;
  remaining.textContent = '0';
  root.dataset.phase = 'moving';
  status.textContent = '已落笔，看看球会滚向哪里。';
  sound({ type: 'cut' });
  consumeEvents(!reducedMotion.matches);
  if (reducedMotion.matches) {
    while (state.phase === 'moving') step(false);
    view.draw(state);
    finish();
    return;
  }
  view.draw(state);
  accumulator = 0;
  previousTime = performance.now();
  frame = requestAnimationFrame(animate);
}

function position(event) {
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return { x: clamp(point.x, 0, level.width), y: clamp(point.y, 0, level.height) };
}
function strokeAt(event) {
  return makeStroke(drag.start, position(event), drag.tolerance);
}
svg.addEventListener('pointerdown', event => {
  if (drag || state.phase !== 'ready' || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  const tolerance = event.pointerType === 'touch' ? clamp(22 / svg.getScreenCTM().a, 12, 44) : 12;
  drag = { id: event.pointerId, start: position(event), tolerance };
  svg.setPointerCapture(event.pointerId);
  const stroke = strokeAt(event);
  view.preview(stroke, hitTest(stroke));
});
svg.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId) return;
  const stroke = strokeAt(event);
  view.preview(stroke, hitTest(stroke));
});
svg.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  const stroke = strokeAt(event);
  drag = null;
  if (Math.hypot(stroke.end.x - stroke.start.x, stroke.end.y - stroke.start.y) < 3) view.clearStroke();
  else submit(stroke);
});
function cancelDrag(event) {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  view.clearStroke();
}
svg.addEventListener('pointercancel', cancelDrag);
svg.addEventListener('lostpointercapture', cancelDrag);
svg.addEventListener('dragstart', event => event.preventDefault());
retry.addEventListener('click', reset);
choices.forEach(button => button.addEventListener('click', () => {
  const option = button.dataset.trial;
  const x = level.pins[option === 'right' ? 1 : 0].x;
  const endX = option === 'both' ? level.pins[1].x : x;
  submit(makeStroke({ x, y: 67 }, { x: endX, y: 79 }, 12));
}));
reset();

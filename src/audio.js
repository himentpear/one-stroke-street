import { clamp } from './level.js';

export function createAudio(button) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let context = null;
  let noiseBuffer = null;
  button.disabled = !AudioCtx;

  function ensureNoise() {
    if (noiseBuffer || !context) return;
    const len = Math.floor(context.sampleRate * 0.18);
    const buffer = context.createBuffer(1, len, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    noiseBuffer = buffer;
  }

  button.addEventListener('click', async () => {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('[data-sound-state]').textContent = enabled ? '开' : '关';
    if (!enabled) return;
    try {
      context ??= new AudioCtx();
      await context.resume();
      ensureNoise();
    } catch {
      button.setAttribute('aria-pressed', 'false');
      button.querySelector('[data-sound-state]').textContent = '关';
    }
  });

  function isReady() {
    return context?.state === 'running' && button.getAttribute('aria-pressed') === 'true';
  }

  function tone(from, to, length, gain, wave) {
    if (!isReady()) return;
    const now = context.currentTime;
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + length);
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.connect(env).connect(context.destination);
    osc.start(now);
    osc.stop(now + length + 0.01);
  }

  function tearNoise(length, gain, centerHz) {
    if (!isReady()) return;
    ensureNoise();
    const now = context.currentTime;
    const src = context.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(centerHz, now);
    filter.Q.setValueAtTime(1.1, now);
    const env = context.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + length);
    src.connect(filter).connect(env).connect(context.destination);
    src.start(now);
    src.stop(now + length + 0.01);
  }

  return event => {
    if (!event) return;
    if (event.type === 'pin') {
      // 1. 卡扣“咔”一声弹开
      tone(820, 260, 0.065, 0.045, 'triangle');
      return;
    }
    if (event.type === 'break') {
      // 2. 撕纸 + 纸板闷响，冲量越重音色越扎实
      const weight = clamp((event.impulse || 2.5) / 4.5, 0.55, 1.5);
      tearNoise(0.11 + weight * 0.03, 0.045 * weight, 920 + (event.count || 1) * 140);
      tone(120 + (event.count || 1) * 32, 58, 0.14, 0.05 * weight, 'triangle');
      if (event.isFinal) tone(96, 36, 0.25, 0.07, 'sine');
      return;
    }
    if (event.type === 'spring') {
      // 3. 弹板起跳
      tone(165, 440, 0.18, 0.06, 'sine');
      tone(310, 560, 0.11, 0.025, 'triangle');
      return;
    }
    if (event.type === 'land' || event.type === 'clack') {
      // 4. 重物落地
      const weight = clamp((event.impulse || 2.2) / 5.5, 0.3, 1.3);
      tone(event.type === 'clack' ? 240 : 108, 42, 0.13, 0.045 * weight, 'sine');
    }
  };
}

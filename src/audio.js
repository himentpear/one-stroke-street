export function createAudio(button) {
  const Audio = window.AudioContext || window.webkitAudioContext;
  let context;
  button.disabled = !Audio;
  button.addEventListener('click', async () => {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('[data-sound-state]').textContent = enabled ? '开' : '关';
    if (!enabled) return;
    try {
      context ??= new Audio();
      await context.resume();
    } catch {
      button.setAttribute('aria-pressed', 'false');
      button.querySelector('[data-sound-state]').textContent = '关';
    }
  });
  function tone(from, to, length, gain, wave) {
    if (context?.state !== 'running' || button.getAttribute('aria-pressed') !== 'true') return;
    const now = context.currentTime, oscillator = context.createOscillator(), envelope = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + length);
    envelope.gain.setValueAtTime(.001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + .008);
    envelope.gain.exponentialRampToValueAtTime(.001, now + length);
    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + length + .01);
  }
  return ({ type, count }) => {
    if (type === 'cut') tone(720, 240, .07, .035, 'triangle');
    if (type === 'break') {
      tone(115 + count * 43, 74 + count * 21, .13, .06, 'triangle');
      if (count === 4) tone(100, 38, .24, .065, 'sine');
    }
    if (type === 'spring') tone(170, 420, .17, .055, 'sine');
    if (type === 'land') tone(105, 48, .14, .04, 'sine');
  };
}

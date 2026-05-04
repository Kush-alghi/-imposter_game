// Lightweight Web Audio API tone generator — no file deps
let ctx: AudioContext | null = null;

function getCtx() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function playTone(
  freq: number,
  duration = 0.25,
  type: OscillatorType = 'sine',
  gain = 0.18
) {
  try {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const gainNode = ac.createGain();
    osc.connect(gainNode);
    gainNode.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    gainNode.gain.setValueAtTime(gain, ac.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
  } catch {
    // AudioContext blocked before user gesture — silently ignore
  }
}

// Preset cues
export const Sounds = {
  join:      () => playTone(880, 0.15, 'sine'),
  start:     () => { playTone(440, 0.1, 'square'); setTimeout(() => playTone(660, 0.15, 'square'), 120); },
  yourTurn:  () => { playTone(523, 0.12, 'sine'); setTimeout(() => playTone(784, 0.2, 'sine'), 130); },
  vote:      () => playTone(300, 0.2, 'sawtooth'),
  result:    () => { playTone(220, 0.3, 'triangle'); setTimeout(() => playTone(110, 0.4, 'triangle'), 320); },
  tick:      () => playTone(1200, 0.05, 'square', 0.06),
  mute:      () => playTone(200, 0.1, 'sawtooth', 0.1),
  unmute:    () => playTone(600, 0.1, 'sine', 0.1),
  kick:      () => playTone(150, 0.3, 'sawtooth', 0.2),
};
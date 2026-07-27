let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(freq: number, duration: number, type: OscillatorType = "sine", gain = 0.15, detune = 0) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

function playChord(freqs: number[], duration: number, type: OscillatorType = "sine", gain = 0.08) {
  freqs.forEach((f, i) => playTone(f, duration, type, gain, i * 2));
}

export function playClick() {
  playTone(1200, 0.06, "square", 0.06);
}

export function playBuyConfirm() {
  playTone(523, 0.12, "sine", 0.12);
  setTimeout(() => playTone(659, 0.12, "sine", 0.12), 80);
  setTimeout(() => playTone(784, 0.18, "sine", 0.14), 160);
  setTimeout(() => playChord([523, 659, 784], 0.3, "sine", 0.06), 240);
}

export function playSellConfirm() {
  playTone(784, 0.12, "sine", 0.12);
  setTimeout(() => playTone(659, 0.12, "sine", 0.12), 80);
  setTimeout(() => playTone(523, 0.18, "sine", 0.14), 160);
  setTimeout(() => playChord([523, 659, 784], 0.3, "sine", 0.06), 240);
}

export function playCancel() {
  playTone(440, 0.15, "triangle", 0.12);
  setTimeout(() => playTone(330, 0.15, "triangle", 0.12), 100);
  setTimeout(() => playTone(220, 0.25, "triangle", 0.10), 200);
}

export function playOrderConfirmed() {
  playChord([880, 1109, 1319], 0.08, "sine", 0.06);
  setTimeout(() => playChord([880, 1109, 1319], 0.25, "sine", 0.08), 60);
}

export function playOrderProgress() {
  playTone(880, 0.08, "sine", 0.08);
  setTimeout(() => playTone(1109, 0.18, "sine", 0.08), 70);
}

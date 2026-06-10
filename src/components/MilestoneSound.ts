// Vrolijk klokkenspel via WebAudio — geen losse asset, werkt overal
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      (window.AudioContext as typeof AudioContext) ||
      ((window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext as typeof AudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume();
}

function note(freq: number, t0: number, dur: number, gain = 0.25) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.value = 0;
  osc.connect(g).connect(c.destination);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playMilestone(percent: number) {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume();
  const t = c.currentTime;
  // Hoe hoger het percentage, hoe groter het akkoord
  const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
  if (percent >= 100) {
    [C5, E5, G5, C6].forEach((f, i) => note(f, t + i * 0.12, 1.2, 0.22));
  } else if (percent >= 75) {
    [C5, E5, G5].forEach((f, i) => note(f, t + i * 0.1, 0.9, 0.2));
  } else if (percent >= 50) {
    [C5, G5].forEach((f, i) => note(f, t + i * 0.08, 0.7, 0.18));
  } else {
    note(C5, t, 0.5, 0.18);
    note(G5, t + 0.08, 0.5, 0.18);
  }
}

export function playDing() {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume();
  const t = c.currentTime;
  note(880, t, 0.18, 0.14);
  note(1320, t + 0.05, 0.18, 0.1);
}

// Zero-dependency procedural audio: oscillators + a shared noise buffer.
let ctx = null, master = null, noise = null;
let muted = localStorage.getItem('tb-mute') === '1', vol = +(localStorage.getItem('tb-vol') ?? .5);
const last = {};
function ensure() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return false;
    ctx = new C(); master = ctx.createGain(); master.gain.value = muted ? 0 : vol; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}
const gate = (k, ms) => { const n = performance.now(); if (n - (last[k] || 0) < ms) return false; last[k] = n; return true; };
function tone(f, d, { type = 'square', v = .22, to, at = 0 } = {}) {
  if (!ensure()) return; const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
  o.connect(g).connect(master); o.start(t); o.stop(t + d + .02);
}
function hiss(d, { v = .3, f = 1000, to, type = 'lowpass', at = 0 } = {}) {
  if (!ensure()) return; const t = ctx.currentTime + at, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; fl.type = type; fl.frequency.setValueAtTime(f, t); if (to) fl.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
  s.connect(fl).connect(g).connect(master); s.start(t); s.stop(t + d + .02);
}
export const sfx = {
  unlock: ensure,
  move() { gate('m', 35) && tone(330, .04, { v: .07 }); },
  rotate() { gate('r', 35) && tone(520, .07, { type: 'triangle', to: 880, v: .12 }); },
  soft() { gate('s', 50) && hiss(.04, { v: .12, f: 700 }); },
  hard() { hiss(.12, { v: .5, f: 500, to: 80 }); tone(150, .16, { type: 'sine', to: 40, v: .5 }); },
  clear(n) {
    if (n >= 4) { [523, 659, 784, 1047].forEach((f, i) => { tone(f, .5, { type: 'triangle', v: .2, at: i * .06 }); tone(f * 2, .35, { v: .07, at: i * .06 }); }); hiss(.3, { v: .2, f: 3000, type: 'highpass' }); }
    else { const f = [523, 659, 784][n - 1]; tone(f, .12, { v: .2 }); tone(f * 1.5, .2, { v: .2, at: .08 }); }
  },
  pickup() { [880, 1175, 1568, 2093].forEach((f, i) => tone(f, .22, { type: 'sine', v: .22, at: i * .06 })); },
  cast() { hiss(.45, { v: .35, f: 400, to: 5000, type: 'bandpass' }); tone(220, .4, { type: 'sawtooth', to: 880, v: .12 }); },
  warn() { [880, 620, 880, 620].forEach((f, i) => tone(f, .12, { v: .13, at: i * .14 })); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i === 6 ? .7 : .16, { type: 'triangle', v: .25, at: i * .14 })); },
  lose() { tone(330, .9, { type: 'sawtooth', to: 70, v: .25 }); hiss(.6, { v: .2, f: 800, to: 60 }); },
  setVolume(v) { vol = v; localStorage.setItem('tb-vol', v); if (master) master.gain.value = muted ? 0 : vol; },
  setMuted(m) { muted = m; localStorage.setItem('tb-mute', m ? '1' : '0'); if (master) master.gain.value = muted ? 0 : vol; },
  isMuted: () => muted, volume: () => vol,
};
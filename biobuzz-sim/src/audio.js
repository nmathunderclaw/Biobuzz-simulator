/* BIOBUZZ Sim — sound: synthesised field cues, robot sounds and spoken field callouts. Starts only after a user gesture. */
(function (root) {
'use strict';
const AU = { ctx: null, master: null, sfx: null, vol: 0.8, sfxVol: 0.8, voice: true, lastImpact: 0, voiceOk: typeof speechSynthesis !== 'undefined' };
AU.unlock = function () {
  if (!AU.ctx) {
    try {
      AU.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      AU.master = AU.ctx.createGain(); AU.master.connect(AU.ctx.destination);
      AU.sfx = AU.ctx.createGain(); AU.sfx.connect(AU.master);
      AU.apply();
    } catch (e) { AU.ctx = null; }
  }
  if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume().catch(() => {});
};
AU.setLevels = function (vol, sfx, voice) { AU.vol = vol; AU.sfxVol = sfx; AU.voice = voice; AU.apply(); };
AU.apply = function () { if (AU.master) { AU.master.gain.value = AU.vol; AU.sfx.gain.value = AU.sfxVol; } };
function out(bus) { return bus === 'field' ? AU.master : AU.sfx; }
function tone(f, d, type, v, when, f2, bus) {
  const c = AU.ctx; if (!c) return;
  const t0 = c.currentTime + (when || 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v || 0.12, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g).connect(out(bus)); o.start(t0); o.stop(t0 + d + 0.02);
}
let noiseBuf = null;
function noise(d, v, freq, type, when, bus) {
  const c = AU.ctx; if (!c) return;
  if (!noiseBuf) { const n = c.sampleRate; noiseBuf = c.createBuffer(1, n, n); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1; }
  const t0 = c.currentTime + (when || 0);
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq || 900;
  const g = c.createGain(); g.gain.setValueAtTime(v || 0.2, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  s.connect(f).connect(g).connect(out(bus)); s.start(t0, Math.random() * 0.5); s.stop(t0 + d + 0.02);
}
// field cues (FTC-style): charge at AUTO start, buzzer at the end of AUTO, bells for TELEOP, whistle for the last minute
AU.cue = {
  start() { [523, 659, 784, 1046].forEach((f, i) => tone(f, i === 3 ? 0.55 : 0.16, 'square', 0.07, i * 0.17, 0, 'field')); },
  autoEnd() { tone(110, 0.9, 'sawtooth', 0.1, 0, 0, 'field'); tone(116, 0.9, 'sawtooth', 0.08, 0, 0, 'field'); },
  count() { tone(880, 0.12, 'square', 0.06, 0, 0, 'field'); },
  tele() { [0, 0.28, 0.56].forEach(w => { tone(1318, 0.5, 'triangle', 0.07, w, 0, 'field'); tone(1976, 0.4, 'sine', 0.03, w, 0, 'field'); }); },
  endgame() { tone(1480, 0.18, 'sine', 0.08, 0, 1760, 'field'); tone(1480, 0.5, 'sine', 0.08, 0.22, 1320, 'field'); },
  end() { tone(98, 1.2, 'sawtooth', 0.1, 0, 0, 'field'); tone(104, 1.2, 'sawtooth', 0.08, 0, 0, 'field'); },
  foul() { tone(2600, 0.09, 'square', 0.05, 0, 2500, 'field'); tone(2600, 0.22, 'square', 0.05, 0.12, 2400, 'field'); },
};
AU.sfxs = {
  shot(k) { noise(0.08, 0.2 * (k || 1), 800); tone(170, 0.08, 'sine', 0.1 * (k || 1), 0, 90); },
  intake() { tone(900, 0.035, 'triangle', 0.03); },
  made() { tone(1175, 0.06, 'sine', 0.03); },
  tip(mine) { noise(0.45, 0.32, 300); tone(100, 0.4, 'sine', 0.16, 0, 55); if (mine) { tone(784, 0.14, 'triangle', 0.06, 0.15); tone(1046, 0.22, 'triangle', 0.06, 0.28); } },
  dunk() { tone(520, 0.08, 'triangle', 0.06); tone(390, 0.1, 'triangle', 0.05, 0.08); },
  arm() { noise(0.12, 0.05, 1800, 'bandpass'); },
  toggle(on) { tone(on ? 1200 : 700, 0.05, 'square', 0.03); },
  nectar() { tone(640, 0.06, 'triangle', 0.04); },
  bump(v) { noise(0.06, Math.min(0.25, v * 0.004), 500); },
  ui() { tone(1400, 0.03, 'square', 0.018); },
};
// ball impacts: a soft tick scaled by speed and distance, rate-limited
AU.impact = function (v, dist, mat) {
  if (!AU.ctx) return;
  const now = AU.ctx.currentTime; if (now - AU.lastImpact < 0.035) return; AU.lastImpact = now;
  const k = Math.min(1, v / 400) * Math.max(0.15, 1 - dist / 260);
  if (k < 0.04) return;
  const f = mat === 1 ? 700 : mat === 2 || mat === 3 ? 2200 : mat === 4 ? 1500 : mat === 6 ? 900 : 1200;
  noise(0.05, 0.16 * k, f, 'bandpass');
};
AU.say = function (text) {
  if (!AU.voice || !AU.voiceOk || !AU.vol) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 1.05; u.volume = Math.min(1, AU.vol);
    speechSynthesis.speak(u);
  } catch (e) { /* speech not available */ }
};
root.BBAU = AU;
})(typeof globalThis !== 'undefined' ? globalThis : this);

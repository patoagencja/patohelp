// Ambient music for the login "Tryb zen", synthesised with Web Audio: no
// audio files to ship or license, nothing loaded until someone opts in.
// A slow two-chord pad, distant "waves" (filtered noise) and the odd
// singing-bowl chime, all through a long feedback delay for space.

// D major pentatonic keeps any chime consonant with either chord.
const CHORDS = [
  [146.83, 220.0, 293.66, 369.99], // D  A  D  F#
  [123.47, 185.0, 246.94, 293.66], // B  F# B  D
];
const CHIMES = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66];

export type ZenAudio = { setMuted: (muted: boolean) => void; stop: () => void };

export function startZenAudio(): ZenAudio | null {
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.55, now + 4);
  master.connect(ctx.destination);

  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.62;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.45;
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(master);

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1600;
  tone.connect(master);
  tone.connect(delay);

  // Pad: a sine and a quiet detuned triangle per chord tone, each breathing
  // on its own slow LFO so the drone never sounds static.
  const voices: OscillatorNode[] = [];
  const padFreqs: AudioParam[] = [];
  CHORDS[0].forEach((freq, i) => {
    const gain = ctx.createGain();
    gain.gain.value = 0.045;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05 + i * 0.017;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.025;
    lfo.connect(lfoDepth).connect(gain.gain);
    lfo.start();
    voices.push(lfo);
    for (const [type, detune, level] of [
      ["sine", 0, 1],
      ["triangle", 6, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(gain);
      osc.start();
      voices.push(osc);
      padFreqs.push(osc.frequency);
    }
    gain.connect(tone);
  });

  // Waves: looped noise through a band-pass whose level swells every ~11 s.
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const surf = ctx.createBufferSource();
  surf.buffer = noise;
  surf.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 420;
  band.Q.value = 0.6;
  const surfGain = ctx.createGain();
  surfGain.gain.value = 0.018;
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.09;
  const swellDepth = ctx.createGain();
  swellDepth.gain.value = 0.016;
  swell.connect(swellDepth).connect(surfGain.gain);
  surf.connect(band).connect(surfGain).connect(master);
  surf.start();
  swell.start();
  voices.push(swell);

  let chord = 0;
  const chordTimer = window.setInterval(() => {
    chord = (chord + 1) % CHORDS.length;
    padFreqs.forEach((p, i) => p.setTargetAtTime(CHORDS[chord][Math.floor(i / 2)], ctx.currentTime, 2.5));
  }, 16_000);

  // Singing bowl: fundamental plus the bowl's inharmonic partial, long decay.
  let chimeTimer = 0;
  const chime = () => {
    const t = ctx.currentTime;
    const freq = CHIMES[Math.floor(Math.random() * CHIMES.length)];
    for (const [ratio, level] of [
      [1, 0.09],
      [2.76, 0.025],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
      osc.connect(g).connect(tone);
      osc.start(t);
      osc.stop(t + 5.1);
    }
    chimeTimer = window.setTimeout(chime, 3500 + Math.random() * 5000);
  };
  chimeTimer = window.setTimeout(chime, 2500);

  let stopped = false;
  return {
    setMuted(muted) {
      if (stopped) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.4);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearInterval(chordTimer);
      window.clearTimeout(chimeTimer);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
      window.setTimeout(() => {
        voices.forEach((v) => v.stop());
        surf.stop();
        void ctx.close();
      }, 1600);
    },
  };
}

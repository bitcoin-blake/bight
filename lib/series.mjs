// The over-time graph: samples every few seconds, capped; points for a line, broken where samples are missing (a hidden
// tab is throttled, so a gap is drawn as a gap, not as a straight line).
export function pushSample(samples, s, cap = 1440) {
  samples.push(s);
  while (samples.length > cap) samples.shift();
  return samples;
}
// → array of runs, each an array of [x, y] in a box of W × H with padding, scaled to the key's own maximum
export function polyline(samples, key, { W, H, pad = 0, gapMs = 20000 } = {}) {
  if (samples.length < 2) return { runs: [], max: 0 };
  const t0 = samples[0].t,
    t1 = samples.at(-1).t;
  const max = Math.max(1, ...samples.map((p) => p[key]));
  const x = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const runs = [];
  let run = [];
  samples.forEach((p, i) => {
    if (i && p.t - samples[i - 1].t > gapMs) {
      if (run.length) runs.push(run);
      run = [];
    }
    run.push([x(p.t), y(p[key])]);
  });
  if (run.length) runs.push(run);
  return { runs, max };
}
export const spanWords = (samples) => {
  if (samples.length < 2) return 'this session';
  const min = Math.round((samples.at(-1).t - samples[0].t) / 60000);
  return min < 90 ? `the last ${min} minutes` : `the last ${(min / 60).toFixed(1)} hours`;
};

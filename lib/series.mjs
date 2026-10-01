// The over-time graph: samples every few seconds, capped; points for a line, broken where samples are missing (a hidden
// tab is throttled, so a gap is drawn as a gap, not as a straight line). Pure; tested in test/lib-test.mjs.
export function pushSample(samples, s, cap = 1440) {
  samples.push(s);
  while (samples.length > cap) samples.shift();
  return samples;
}
// → { runs: [[x, y], …][], top, scale }: points in a W × H box with padding, scaled to the key's own maximum (scale is that
// maximum, at least 1, so an empty series draws on the floor; top is the true maximum, 0 for an empty mempool all along).
// A run of one point (a sample with gaps on both sides) is drawn by the page as a dot.
export function polyline(samples, key, { W, H, pad = 0, gapMs = 20000 } = {}) {
  if (!samples.length) return { runs: [], top: 0, scale: 1 };
  const t0 = samples[0].t,
    t1 = samples.at(-1).t;
  const top = Math.max(0, ...samples.map((p) => p[key]));
  const scale = Math.max(1, top);
  const x = (t) => (t1 === t0 ? W / 2 : pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad));
  const y = (v) => H - pad - (v / scale) * (H - 2 * pad);
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
  return { runs, top, scale };
}
export const spanWords = (samples) => {
  if (samples.length < 2) return 'this session';
  const min = Math.round((samples.at(-1).t - samples[0].t) / 60000);
  return min < 90 ? `the last ${min} minutes` : `the last ${(min / 60).toFixed(1)} hours`;
};

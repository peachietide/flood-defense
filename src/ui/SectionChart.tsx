import type { Stats } from '../sim/game';

const W = 300;
const PAD = 8;

/** 降雨过程线：雨强随时间的分布 + 当前时刻标记 */
function RainStrip({ curve, progress }: { curve: Float32Array; progress: number }) {
  const H = 46;
  const n = curve.length;
  let max = 0;
  for (let i = 0; i < n; i++) if (curve[i] > max) max = curve[i];
  const peak = max || 1;

  const px = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const py = (v: number) => H - 4 - (v / peak) * (H - 10);

  const pts: string[] = [];
  for (let i = 0; i < n; i++) pts.push(`${px(i).toFixed(1)},${py(curve[i]).toFixed(1)}`);
  const area = `M${px(0).toFixed(1)},${H} L${pts.join(' L')} L${px(n - 1).toFixed(1)},${H} Z`;
  const nx = px(progress * (n - 1));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rainSvg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="rainFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6fb6f0" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#2b6fa8" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rainFill)" />
      <line x1={nx} y1={0} x2={nx} y2={H} stroke="#ffb454" strokeWidth="1.4" />
    </svg>
  );
}

/** 横剖面：地面 + 水面 */
function SectionStrip({ stats }: { stats: Stats }) {
  const { ground, surface, facilityIndex } = stats.profile;
  const H = 112;
  const n = ground.length;

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (ground[i] < lo) lo = ground[i];
    if (surface[i] > hi) hi = surface[i];
  }
  lo -= 1.2;
  hi += 1.2;
  const span = Math.max(1e-6, hi - lo);

  const px = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const py = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);

  const groundPts = ground.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`);
  const surfacePts = surface.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`);

  const groundArea = `M${groundPts.join(' L')} L${px(n - 1).toFixed(1)},${H} L${px(0).toFixed(1)},${H} Z`;
  const waterArea = `M${surfacePts.join(' L')} L${groundPts.slice().reverse().join(' L')} Z`;

  const fx = px(facilityIndex);
  const fg = py(ground[facilityIndex]);
  const fs = py(surface[facilityIndex]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="secSvg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="secWater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7fd4e8" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#14507a" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      <path d={groundArea} fill="#5b4b38" stroke="#8a7658" strokeWidth="0.8" />
      <path d={waterArea} fill="url(#secWater)" />
      <line x1={fx} y1={fs} x2={fx} y2={fg} stroke="#f0c040" strokeWidth="1.6" />
      <circle cx={fx} cy={Math.min(fs, fg) - 3} r="2.2" fill="#f0c040" />
    </svg>
  );
}

export default function SectionChart({ stats }: { stats: Stats }) {
  // 雨强倍率一般在 0~1.6 之间，映射成 0~100%
  const pct = Math.round((stats.rainNow / 1.6) * 100);
  return (
    <div className="panel section">
      <div className="secHead">
        <span>降雨过程线</span>
        <span className="secY">当前 {Math.max(0, Math.min(100, pct))}%</span>
      </div>
      <RainStrip curve={stats.rainCurve} progress={stats.progress} />

      <div className="secHead" style={{ marginTop: 8 }}>
        <span>横剖面 · 穿过变电站</span>
        <span className="secY">0.25 m 淹没线</span>
      </div>
      <SectionStrip stats={stats} />

      <div className="secFoot">左 ← 西 · 东 → 右</div>
    </div>
  );
}

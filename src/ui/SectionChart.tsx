import type { ProfileSample } from '../sim/game';

const W = 300;
const H = 128;
const PAD = 8;

/**
 * 穿过变电站的横剖面：地面 + 水面。
 * 用纯 SVG 画，不引入图表库——省体积，也好控制样式。
 */
export default function SectionChart({ profile }: { profile: ProfileSample }) {
  const { ground, surface, facilityIndex } = profile;
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
  // 水面 = 水面线正向 + 地面线反向
  const waterArea = `M${surfacePts.join(' L')} L${groundPts.slice().reverse().join(' L')} Z`;

  const fx = px(facilityIndex);
  const fg = py(ground[facilityIndex]);
  const fs = py(surface[facilityIndex]);

  return (
    <div className="panel section">
      <div className="secHead">
        <span>横剖面 · 穿过变电站</span>
        <span className="secY">
          {hi.toFixed(0)} / {lo.toFixed(0)} m
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="secSvg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="secWater" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7fd4e8" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#14507a" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        <path d={groundArea} fill="#5b4b38" stroke="#8a7658" strokeWidth="0.8" />
        <path d={waterArea} fill="url(#secWater)" />

        {/* 变电站位置 */}
        <line x1={fx} y1={fs} x2={fx} y2={fg} stroke="#f0c040" strokeWidth="1.6" />
        <circle cx={fx} cy={Math.min(fs, fg) - 3} r="2.2" fill="#f0c040" />
      </svg>
      <div className="secFoot">左 ← 西 · 东 → 右</div>
    </div>
  );
}

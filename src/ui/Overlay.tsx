import type { Stats } from '../sim/game';
import { fmtDepth, fmtSpeed, fmtTime } from './format';

export default function Overlay({ stats, onReset }: { stats: Stats; onReset: () => void }) {
  if (stats.phase !== 'over') return null;
  const won = stats.won && stats.hp > 0;
  const { site, domain } = stats;

  return (
    <div className="overlayWrap">
      <div className="overlay">
        <h2 style={{ color: won ? '#4ade80' : '#ff6b6b' }}>{won ? '✅ 守住了' : '❌ 变电站被淹'}</h2>
        <p>
          {won
            ? `设施完好度 ${Math.round(stats.hp)}% · 剩余预算 ${Math.max(0, stats.budget)} · 淹没面积 ${Math.round(stats.floodedPct)}%`
            : '试试把变电站场地垫高到洪水位以上，或在低洼处布置水泵。'}
        </p>

        <div className="ovGrid">
          <span>变电站最大水深</span>
          <span>{fmtDepth(site.depth)} m</span>
          <span>变电站最大流速</span>
          <span>{site.speed < 0.01 ? '—' : `${fmtSpeed(site.speed)} m/s`}</span>
          <span>淹没历时</span>
          <span>{fmtTime(site.duration)}</span>
          <span>洪水到达时刻</span>
          <span>{fmtTime(site.arrival)}</span>
          <span>全域最大水深</span>
          <span>{fmtDepth(domain.depth)} m</span>
          <span>全域最大流速</span>
          <span>{fmtSpeed(domain.speed)} m/s</span>
        </div>

        <button onClick={onReset}>再来一局</button>
      </div>
    </div>
  );
}

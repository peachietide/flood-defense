import type { Stats } from '../sim/game';
import { RAIN_PRESETS } from '../sim/scenarios';
import { fmtDepth, fmtSpeed, fmtTime } from './format';

export default function Overlay({ stats, onReset }: { stats: Stats; onReset: () => void }) {
  if (stats.phase !== 'over') return null;
  const won = stats.won && stats.hp > 0;
  const { site, domain } = stats;

  // 本局做了什么防护
  const parts: string[] = [];
  if (stats.leveeCount > 0) parts.push(`加高 ${stats.leveeCount} 次`);
  if (stats.hasRing) parts.push('围堰 1 道');
  if (stats.pumpCount > 0) parts.push(`水泵 ${stats.pumpCount} 台`);
  const defense = parts.length ? parts.join(' · ') : '没有做任何防护';

  // 输了要告诉玩家"为什么输"，否则 11 秒一局根本学不到东西
  let tip = '';
  if (!won) {
    if (!parts.length) {
      tip = '这一局什么都没做。先加高场地，或者围堰配水泵。';
    } else if (stats.hasRing && stats.pumpCount === 0) {
      tip = '围了堰却没配水泵：堤内的雨排不出去，反而比不修更糟。';
    } else if (stats.pumpCount > 0 && stats.pumpFlooded === stats.pumpCount) {
      tip = '水泵全被淹停机了（泵房进水超过 1 米），应该放在地势更高的地方。';
    } else if (stats.leveeCount === 1) {
      tip = '只加高了一次，洪水位还差一截——再加高一次就够。';
    } else {
      tip = '加高和泵都用了还是没守住，试试更彻底的方案：加高两次，或围堰 + 水泵。';
    }
  }

  return (
    <div className="overlayWrap">
      <div className="overlay">
        <h2 style={{ color: won ? '#4ade80' : '#ff6b6b' }}>{won ? '✅ 守住了' : '❌ 变电站被淹'}</h2>
        <p>
          {won
            ? `设施完好度 ${Math.round(stats.hp)}% · 剩余预算 ${Math.max(0, stats.budget)} · 淹没面积 ${Math.round(stats.floodedPct)}%`
            : '本次布防没有挡住这一场雨。'}
        </p>

        <div className="ovDefense">本局防护：{defense}</div>

        <div className="ovGrid">
          <span>降雨重现期</span>
          <span>
            {RAIN_PRESETS.find((p) => Math.abs(p.scale - stats.rainScale) < 1e-6)?.label ?? '—'}一遇
          </span>
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

        {tip ? <div className="ovTip">💡 {tip}</div> : null}

        <button onClick={onReset}>再来一局</button>
      </div>
    </div>
  );
}

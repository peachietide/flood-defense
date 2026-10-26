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

  // 输了要说清楚"发生了什么"，但不要说"该怎么做"——
  // 给答案会把玩法变成执行，玩家就没有自己推理的空间了。
  let tip = '';
  if (!won) {
    const d = fmtDepth(site.depth);
    if (!parts.length) {
      tip = `这一局没有做任何防护，洪水直接漫过厂坪，最大水深 ${d} m。`;
    } else if (stats.hasRing && stats.pumpCount === 0) {
      tip = '围堰把外面的洪水挡住了，但堤内的雨排不出去——水位是从围堰里面涨上来的。';
    } else if (stats.pumpCount > 0 && stats.pumpFlooded === stats.pumpCount) {
      tip = `${stats.pumpFlooded} 台水泵全部被水淹停（泵房进水超过 1 米），实际上没有起抽水作用。`;
    } else if (stats.leveeCount === 1) {
      tip = `只加高了一次，最大水深仍有 ${d} m，水位还是漫过了厂坪。`;
    } else {
      tip = `加高和水泵都用了，最大水深仍有 ${d} m，防护没有盖过这一场洪水。`;
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

        {won ? (
          <div className={`ovGrade ${stats.grade}`}>
            <b>评级 {stats.grade}</b>
            <span>
              {stats.grade === 'A'
                ? `花了 ${stats.spent}，接近这个厂址的最低可行成本`
                : `花了 ${stats.spent}，其实 ${stats.parCost} 左右就够——还有更省的做法`}
            </span>
          </div>
        ) : null}

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

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
  const defense = parts.length ? parts.join(' · ') : '未采取防护措施';

  // 输了要说清楚"发生了什么"，但不要说"该怎么做"——
  // 给答案会把玩法变成执行，玩家就没有自己推理的空间了。
  let tip = '';
  if (!won) {
    const d = fmtDepth(site.depth);
    if (!parts.length) {
      tip = `本局未采取防护措施，洪水漫过厂坪，最大水深 ${d} m。`;
    } else if (stats.hasRing && stats.pumpCount === 0) {
      tip = '围堰阻挡了外部洪水，但堤内降雨无法排出——水位自围堰内部上涨。';
    } else if (stats.pumpCount > 0 && stats.pumpFlooded === stats.pumpCount) {
      tip = `${stats.pumpFlooded} 台水泵因泵房进水超过 1 米而停机，未产生抽水效果。`;
    } else if (stats.leveeCount === 1) {
      tip = `场地仅加高一次，最大水深仍有 ${d} m，水位超过厂坪。`;
    } else {
      tip = `加高与水泵均已使用，最大水深仍达 ${d} m，防护未覆盖本场洪水。`;
    }
  }

  return (
    <div className="overlayWrap">
      <div className="overlay">
        <h2 style={{ color: won ? '#4ade80' : '#ff6b6b' }}>{won ? '✅ 守住了' : '❌ 变电站被淹'}</h2>
        <p>
          {won
            ? `设施完好度 ${Math.round(stats.hp)}% · 剩余预算 ${Math.max(0, stats.budget)} · 淹没面积 ${Math.round(stats.floodedPct)}%`
            : '本次布防未能挡住本场降雨。'}
        </p>

        <div className="ovDefense">本局防护：{defense}</div>

        {won ? (
          <div className={`ovGrade ${stats.grade}`}>
            <b>评级 {stats.grade}</b>
            <span>
              {stats.grade === 'A'
                ? `花费 ${stats.spent}，接近本厂址守住所需的最低成本`
                : `花费 ${stats.spent}，并非最省方案——仍有更低的成本可以守住`}
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

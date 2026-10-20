import type { Stats } from '../sim/game';

export default function Overlay({ stats, onReset }: { stats: Stats; onReset: () => void }) {
  if (stats.phase !== 'over') return null;
  const won = stats.won && stats.hp > 0;
  return (
    <div className="overlayWrap">
      <div className="overlay">
        <h2 style={{ color: won ? '#4ade80' : '#ff6b6b' }}>{won ? '✅ 守住了' : '❌ 变电站被淹'}</h2>
        <p>
          {won
            ? `设施完好度 ${Math.round(stats.hp)}% · 剩余预算 ${Math.max(0, stats.budget)} · 淹没面积 ${Math.round(stats.floodedPct)}%`
            : '试试把变电站场地垫高到洪水位以上，或在低洼处布置水泵。'}
        </p>
        <button onClick={onReset}>再来一局</button>
      </div>
    </div>
  );
}

import type { Stats } from '../sim/game';

function hpClass(hp: number): string {
  if (hp > 60) return 'good';
  if (hp > 25) return 'warn';
  return 'bad';
}

function floodClass(pct: number): string {
  if (pct > 35) return 'bad';
  if (pct > 15) return 'warn';
  return '';
}

export default function Hud({ stats }: { stats: Stats }) {
  const hp = Math.max(0, stats.hp);
  return (
    <div className="panel topbar">
      <div className="stat">
        <div className="k">预算</div>
        <div className="v">{Math.max(0, stats.budget)}</div>
      </div>
      <div className="stat">
        <div className="k">设施完好度</div>
        <div className={`v ${hpClass(hp)}`}>{Math.round(hp)}%</div>
        <div className="hpbar">
          <div
            className="hpfill"
            style={{
              width: `${hp}%`,
              background: hp > 60 ? '#4ade80' : hp > 25 ? '#ffb454' : '#ff6b6b',
            }}
          />
        </div>
      </div>
      <div className="stat">
        <div className="k">淹没面积</div>
        <div className={`v ${floodClass(stats.floodedPct)}`}>{Math.round(stats.floodedPct)}%</div>
      </div>
      <div className="stat">
        <div className="k">剩余时间</div>
        <div className="v">{Math.ceil(Math.max(0, stats.timeLeft))}s</div>
      </div>
    </div>
  );
}

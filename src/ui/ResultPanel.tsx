import type { Metric, Stats } from '../sim/game';
import { fmtDepth, fmtSpeed, fmtTime } from './format';

function riskOf(m: Metric): { label: string; cls: string } {
  if (!m.flooded) return { label: '未淹没', cls: 'ok' };
  if (m.depth < 0.5) return { label: '轻度淹没', cls: 'warn' };
  if (m.depth < 1.5) return { label: '中度淹没', cls: 'warn' };
  return { label: '严重淹没', cls: 'bad' };
}

function Row({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="row">
      <span className="rl">{label}</span>
      <span className="rv">
        {value}
        {unit ? <em>{unit}</em> : null}
      </span>
    </div>
  );
}

export default function ResultPanel({ stats }: { stats: Stats }) {
  const { site, domain } = stats;
  const risk = riskOf(site);

  return (
    <div className="panel results">
      <div className="resHead">
        <span>淹没指标</span>
        <span className={`grade ${risk.cls}`}>{risk.label}</span>
      </div>

      <div className="resSub">变电站位置</div>
      <Row label="最大水深" value={fmtDepth(site.depth)} unit=" m" />
      <Row label="最大流速" value={fmtSpeed(site.speed)} unit={site.speed < 0.01 ? '' : ' m/s'} />
      <Row label="淹没历时" value={fmtTime(site.duration)} />
      <Row label="洪水到达" value={fmtTime(site.arrival)} />

      <div className="resDivider" />

      <div className="resSub">全域极值</div>
      <div className="domLine">
        水深 <b>{fmtDepth(domain.depth)} m</b> · 流速 <b>{fmtSpeed(domain.speed)} m/s</b>
      </div>
      <div className="domLine">
        最长淹没 <b>{fmtTime(domain.duration)}</b> · 最早到达 <b>{fmtTime(domain.arrival)}</b>
      </div>

      {stats.pumpCount > 0 ? (
        <div className={`domLine pumpLine ${stats.pumpFlooded > 0 ? 'pumpOff' : ''}`}>
          {stats.pumpFlooded > 0 ? '⚠ ' : ''}水泵 <b>{stats.pumpCount}</b> 台
          {stats.pumpFlooded > 0 ? (
            <>
              {' '}
              · 已停机 <b>{stats.pumpFlooded}</b> 台
            </>
          ) : null}
        </div>
      ) : null}

      <div className="resFoot">
        {stats.elapsed > 0 ? `已模拟 ${stats.elapsed.toFixed(0)} s` : '降雨开始后逐帧统计'}
      </div>
    </div>
  );
}

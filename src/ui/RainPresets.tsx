import { RAIN_PRESETS } from '../sim/scenarios';
import type { Phase } from '../sim/game';

interface Props {
  scale: number;
  phase: Phase;
  onSelect: (scale: number) => void;
}

/** 降雨重现期选择：工程上用"多少年一遇"表达雨强 */
export default function RainPresets({ scale, phase, onSelect }: Props) {
  const locked = phase !== 'prepare';
  return (
    <>
      <div className="resSub">降雨重现期</div>
      <div className="scenarios">
        {RAIN_PRESETS.map((p) => (
          <button
            key={p.id}
            className={`chip ${Math.abs(p.scale - scale) < 1e-6 ? 'active' : ''}`}
            disabled={locked}
            title={locked ? '先结束当前这一局再调整' : p.note}
            onClick={() => onSelect(p.scale)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </>
  );
}

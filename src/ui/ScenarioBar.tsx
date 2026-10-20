import { SCENARIO_ORDER, SCENARIOS } from '../sim/scenarios';
import type { ScenarioId } from '../sim/scenarios';
import type { Phase } from '../sim/game';

interface Props {
  current: ScenarioId;
  phase: Phase;
  onSelect: (id: ScenarioId) => void;
}

export default function ScenarioBar({ current, phase, onSelect }: Props) {
  const locked = phase !== 'prepare';
  return (
    <div className="scenarios">
      {SCENARIO_ORDER.map((id) => {
        const s = SCENARIOS[id];
        return (
          <button
            key={id}
            className={`chip ${id === current ? 'active' : ''}`}
            disabled={locked}
            title={locked ? '先结束当前这一局再切换场景' : s.description}
            onClick={() => onSelect(id)}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

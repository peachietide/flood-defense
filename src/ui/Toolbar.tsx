import type { Phase, Tool } from '../sim/game';
import { CFG } from '../sim/game';

interface Props {
  phase: Phase;
  tool: Tool;
  onTool: (tool: Tool) => void;
  onStart: () => void;
  onReset: () => void;
}

export default function Toolbar({ phase, tool, onTool, onStart, onReset }: Props) {
  const running = phase !== 'prepare';
  return (
    <div className="panel toolbar">
      <button onClick={onStart} disabled={phase !== 'prepare'}>
        ▶ 开始降雨
      </button>
      <div className="sep" />
      <button className={tool === 'levee' ? 'on' : ''} disabled={running} onClick={() => onTool('levee')}>
        ⛰ 加高场地<span className="cost">{CFG.leveeCost}</span>
      </button>
      <button className={tool === 'pump' ? 'on' : ''} disabled={running} onClick={() => onTool('pump')}>
        💧 水泵<span className="cost">{CFG.pumpCost}</span>
      </button>
      <div className="sep" />
      <button onClick={onReset}>↺ 重来</button>
    </div>
  );
}

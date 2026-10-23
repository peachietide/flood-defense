import type { Phase, Tool } from '../sim/game';
import { CFG } from '../sim/game';

interface Props {
  phase: Phase;
  tool: Tool;
  budget: number;
  nextLeveeCost: number;
  hasRing: boolean;
  /** 已经布防过东西，提示玩家可以开跑了 */
  nudge?: boolean;
  onTool: (tool: Tool) => void;
  onStart: () => void;
  onReset: () => void;
}

export default function Toolbar({
  phase,
  tool,
  budget,
  nextLeveeCost,
  hasRing,
  nudge = false,
  onTool,
  onStart,
  onReset,
}: Props) {
  const running = phase !== 'prepare';
  // 买不起就直接禁用：点了没反应、底部只闪一下红字，玩家会以为程序坏了
  const noLevee = running || budget < nextLeveeCost;
  const noRing = running || hasRing || budget < CFG.ringCost;
  const noPump = running || budget < CFG.pumpCost;

  return (
    <div className="panel toolbar">
      <button className={nudge && !running ? 'nudge' : ''} onClick={onStart} disabled={phase !== 'prepare'}>
        ▶ 开始降雨
      </button>
      <div className="sep" />
      <button
        className={tool === 'levee' ? 'on' : ''}
        disabled={noLevee}
        title={noLevee && !running ? `预算不足（需 ${nextLeveeCost}）` : ''}
        onClick={() => onTool('levee')}
      >
        ⛰ 加高场地<span className="cost">{nextLeveeCost}</span>
      </button>
      <button
        className={tool === 'ring' ? 'on' : ''}
        disabled={noRing}
        title={hasRing ? '围堰已经建好' : noRing && !running ? `预算不足（需 ${CFG.ringCost}）` : ''}
        onClick={() => onTool('ring')}
      >
        🧱 围堰<span className="cost">{hasRing ? '已建' : CFG.ringCost}</span>
      </button>
      <button
        className={tool === 'pump' ? 'on' : ''}
        disabled={noPump}
        title={noPump && !running ? `预算不足（需 ${CFG.pumpCost}）` : ''}
        onClick={() => onTool('pump')}
      >
        💧 水泵<span className="cost">{CFG.pumpCost}</span>
      </button>
      <div className="sep" />
      <button onClick={onReset}>↺ 重来</button>
    </div>
  );
}

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
  speed: number;
  onSpeed: (v: number) => void;
  onTool: (tool: Tool) => void;
  onStart: () => void;
  onReset: () => void;
}

// 只保留 1× 和 2×：4× 下水面变化太快，看不清洪水怎么走，
// 参数一旦出问题也很难归因，收益不值这个复杂度。
const SPEEDS = [1, 2];

export default function Toolbar({
  phase,
  tool,
  budget,
  nextLeveeCost,
  hasRing,
  nudge = false,
  speed,
  onSpeed,
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

      {running ? (
        // 开跑后工具全部不可用，这块位置换成倍速——不然就是一整段无事可做的等待
        <>
          <span className="speedLabel">播放速度</span>
          {SPEEDS.map((v) => (
            <button
              key={v}
              className={`speed ${speed === v ? 'on' : ''}`}
              onClick={() => onSpeed(v)}
            >
              {v}×
            </button>
          ))}
        </>
      ) : (
        <>
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
            title={hasRing ? '围堰已建成' : noRing && !running ? `预算不足（需 ${CFG.ringCost}）` : ''}
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
        </>
      )}

      <div className="sep" />
      <button onClick={onReset}>↺ 重来</button>
    </div>
  );
}

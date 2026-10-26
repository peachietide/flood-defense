import { useCallback, useEffect, useRef, useState } from 'react';
import FloodScene from './scene/FloodScene';
import Hud from './ui/Hud';
import Toolbar from './ui/Toolbar';
import Overlay from './ui/Overlay';
import Legend from './ui/Legend';
import ResultPanel from './ui/ResultPanel';
import ScenarioBar from './ui/ScenarioBar';
import SectionChart from './ui/SectionChart';
import RainPresets from './ui/RainPresets';
import { CFG, GameSim } from './sim/game';
import { SCENARIOS } from './sim/scenarios';
import type { ScenarioId } from './sim/scenarios';
import type { PlaceResult, Stats, Tool } from './sim/game';
import {
  beginSession,
  track,
  trackFirstAction,
  trackResult,
  sessionCount,
  downloadJson,
} from './telemetry';

export default function App() {
  const [sim] = useState(() => new GameSim('canyon'));
  const [stats, setStats] = useState<Stats>(() => sim.stats());
  const [scenarioId, setScenarioId] = useState<ScenarioId>('canyon');
  const [tool, setTool] = useState<Tool>('levee');
  const [toast, setToast] = useState('');
  const [toastAlert, setToastAlert] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const lastPhase = useRef<Stats['phase']>('prepare');
  const [sessions, setSessions] = useState(() => sessionCount());

  const scenario = SCENARIOS[scenarioId];

  const showToast = useCallback((text: string, alert = true) => {
    setToast(text);
    setToastAlert(alert);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1400);
  }, []);

  useEffect(() => {
    beginSession('canyon', 1);
    // 会话一开始就落盘了，这里同步一下计数，否则按钮会一直是灰的
    setSessions(sessionCount());
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const handleStats = useCallback((next: Stats) => {
    setStats(next);
    // 一局结束时记录一次结果
    if (next.phase === 'over' && lastPhase.current !== 'over') {
      trackResult({
        won: next.won,
        hp: next.hp,
        budget: next.budget,
        elapsed: next.elapsed,
        floodedPct: next.floodedPct,
        pumps: next.pumpCount,
        pumpsFlooded: next.pumpFlooded,
      });
      setSessions(sessionCount());
    }
    lastPhase.current = next.phase;
  }, []);

  const handlePlace = useCallback(
    (result: PlaceResult, cell: { x: number; z: number }) => {
      if (!result.ok && result.reason) {
        showToast(result.reason);
      } else if (result.ok && result.cost) {
        showToast(`已花费 ${result.cost}`, false);
      }
      trackFirstAction('place');
      track('place', {
        tool,
        x: cell.x,
        z: cell.z,
        ok: result.ok,
        cost: result.cost ?? 0,
        // 记下被拒原因，下次看数据就知道是"太远"还是"没钱"
        reason: result.ok ? '' : (result.reason ?? ''),
      });
      setStats(sim.stats());
    },
    [sim, showToast, tool],
  );

  const handleStart = useCallback(() => {
    trackFirstAction('start');
    track('start', { budgetLeft: sim.budget, pumps: sim.pumps.length });
    sim.start();
    setStats(sim.stats());
  }, [sim]);

  const handleReset = useCallback(() => {
    track('restart');
    lastPhase.current = 'prepare';
    sim.reset();
    setStats(sim.stats());
    setTool('levee');
    setToast('');
  }, [sim]);

  const handleScenario = useCallback(
    (id: ScenarioId) => {
      if (id === sim.scenarioId) return;
      track('scenario', { id });
      lastPhase.current = 'prepare';
      sim.loadScenario(id);
      setScenarioId(id);
      setStats(sim.stats());
      setTool('levee');
      setToast('');
    },
    [sim],
  );

  const handleRainScale = useCallback(
    (scale: number) => {
      const r = sim.setRainScale(scale);
      if (!r.ok && r.reason) showToast(r.reason);
      track('preset', { scale });
      setStats(sim.stats());
    },
    [sim, showToast],
  );

  /** 导出试玩记录。即使计数为 0 也允许点，避免按钮一直是灰的让人以为坏了 */
  const handleExport = useCallback(() => {
    const n = sessionCount();
    setSessions(n);
    if (n === 0) {
      showToast('还没有记录，先玩一局');
      return;
    }
    downloadJson();
  }, [showToast]);

  // 已经放东西了，就不再教"点哪里"，而是催他开跑——实测有玩家方案做对了却一直没点开始
  const armed = stats.phase === 'prepare' && (stats.leveeCount > 0 || stats.pumpCount > 0 || stats.hasRing);

  // 当前工具已经买不起了：直接说明，别让玩家一直点、一直被拒
  const toolCost =
    tool === 'levee' ? stats.nextLeveeCost : tool === 'ring' ? CFG.ringCost : CFG.pumpCost;
  const toolBlocked =
    stats.phase === 'prepare' &&
    ((tool === 'ring' && stats.hasRing) || stats.budget < toolCost);

  // 围堰单独用必输：它只挡外面的洪水，堤内的积水得靠水泵排。
  // 建完就催"可以开跑了"会把人送进一个注定失败的局。
  const ringNeedsPump = stats.phase === 'prepare' && stats.hasRing && stats.pumpCount === 0;
  const canAffordPump = stats.budget >= CFG.pumpCost;
  // 反过来也一样：没有围堰，水泵只能排出 50 m² 内的水，挡不住外面来的洪水
  const pumpNeedsRing = stats.phase === 'prepare' && stats.pumpCount > 0 && !stats.hasRing;
  const canAffordRing = stats.budget >= CFG.ringCost;

  const hint =
    stats.phase === 'prepare'
      ? ringNeedsPump
        ? canAffordPump
          ? '围堰只挡住外面的洪水——堤内的积水要靠水泵排出去'
          : '围堰只挡住外面的洪水，但已经买不起水泵了——这局很难守住，可以重来'
        : pumpNeedsRing
          ? canAffordRing
            ? '水泵只排得动堤内的积水——外面的洪水还需要围堰挡住'
            : '水泵只排得动堤内的积水，但已经买不起围堰了——这局很难守住'
          : toolBlocked
            ? tool === 'ring' && stats.hasRing
              ? '围堰已经建好了，可以开跑或者重来'
              : `预算不够了（还差 ${toolCost - stats.budget}）——可以开跑，或者重来`
            : armed
              ? '布防好了？点下面的「开始降雨」'
              : tool === 'levee'
                ? '点击光圈内，把场地垫高'
                : tool === 'ring'
                  ? '点击变电站附近筑一圈围堰——堤内的水还要靠水泵排'
                  : '点击光圈内低洼处，放一台水泵'
      : '';

  return (
    <div className="app">
      <FloodScene sim={sim} tool={tool} onStats={handleStats} onPlace={handlePlace} />

      <div className="hud">
        <div className="panel info">
          <b>山洪防线</b>
          <span className="tag">原型演示</span>

          <ScenarioBar current={scenarioId} phase={stats.phase} onSelect={handleScenario} />

          <div className="cust">{scenario.customer}</div>
          <div className="desc">{scenario.description}</div>
          <div className="chal">难点：{scenario.challenge}</div>

          <RainPresets scale={stats.rainScale} phase={stats.phase} onSelect={handleRainScale} />

          <div className="dim">拖动旋转 · 滚轮缩放 · 点击施工</div>
          <div className="warn">⚠ 物理过程为简化模型，仅用于视觉演示，非工程精度</div>

          <div className="meta">
            预算 {scenario.budget} · 时长 {scenario.duration}s · 网格 {(112 * 112 / 1000).toFixed(1)}k
          </div>

          <button className="telBtn" onClick={handleExport}>
            导出试玩记录（{sessions}）
          </button>
        </div>

        <Hud stats={stats} />

        <ResultPanel stats={stats} />

        <SectionChart stats={stats} />

        <Toolbar
          phase={stats.phase}
          tool={tool}
          budget={stats.budget}
          nextLeveeCost={stats.nextLeveeCost}
          hasRing={stats.hasRing}
          nudge={armed}
          onTool={setTool}
          onStart={handleStart}
          onReset={handleReset}
        />

        <Legend />
        {toast || hint ? (
          <div className={`hint ${toast && toastAlert ? 'alert' : ''}`}>
            <span className="hintIcon">{toast && toastAlert ? '⚠' : '👆'}</span>
            <span className="hintText">
              <span className="hintMain">{toast || hint}</span>
              {!toast && stats.phase === 'prepare' ? (
                <span className="hintSub">拖动旋转 · 滚轮缩放 · 点击施工</span>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>

      <Overlay stats={stats} onReset={handleReset} />
    </div>
  );
}

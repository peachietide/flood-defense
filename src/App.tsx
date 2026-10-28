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
import { GameSim } from './sim/game';
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
  const [speed, setSpeed] = useState(1);
  const [toast, setToast] = useState('');
  const [toastAlert, setToastAlert] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const lastPhase = useRef<Stats['phase']>('prepare');
  const peakShown = useRef(false);
  const shownFloodedPumps = useRef(0);
  const [sessions, setSessions] = useState(() => sessionCount());

  const scenario = SCENARIOS[scenarioId];

  const showToast = useCallback((text: string, alert = true, ms = 1400) => {
    setToast(text);
    setToastAlert(alert);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), ms);
  }, []);

  useEffect(() => {
    beginSession('canyon', 1);
    // 会话一开始就落盘了，这里同步一下计数，否则按钮会一直是灰的
    setSessions(sessionCount());
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const handleStats = useCallback(
    (next: Stats) => {
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
      // 洪峰过去时给一个节点提示，等待期才有节奏感
      if (next.peakPassed && !peakShown.current) {
        peakShown.current = true;
        showToast('洪峰已过，水位开始回落', false);
      }
      // 水泵被淹停机：必须在横幅上明说，光靠标记变红玩家容易漏看
      if (next.phase === 'running' && next.pumpFlooded > shownFloodedPumps.current) {
        shownFloodedPumps.current = next.pumpFlooded;
        showToast(`${next.pumpFlooded} 台水泵被淹停机 · 泵房进水超过 1 米，已停止抽水`, true, 3000);
      }
      if (next.phase === 'prepare') {
        peakShown.current = false;
        shownFloodedPumps.current = 0;
      }
      lastPhase.current = next.phase;
    },
    [showToast],
  );

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
    setSpeed(1);
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
      setSpeed(1);
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
      showToast('暂无记录，请先完成一局');
      return;
    }
    downloadJson();
  }, [showToast]);

  // 提示只描述"现在的状态 + 下一步能做什么"，不替玩家预设他会继续用哪个工具，
  // 也不预言这局会不会输——那样会把玩家没做的选择当成既定事实。
  const placed = stats.leveeCount > 0 || stats.pumpCount > 0 || stats.hasRing;

  let hintText = '';
  if (stats.phase === 'prepare') {
    if (!placed) {
      hintText =
        tool === 'levee'
          ? '在光圈内点击，抬高场地'
          : tool === 'ring'
            ? '在变电站附近点击，修筑围堰'
            : '在光圈内低洼处点击，布置水泵';
    } else if (stats.hasRing && stats.pumpCount === 0) {
      // 围堰挡外水、堤内积水靠泵排——这是机制，不是猜测。
      // 措辞只陈述机制，不判断"这局会不会输"。
      hintText = '围堰只拦截外部洪水，堤内积水仍需水泵排出——青色区域可以布置水泵';
    } else {
      // 问句，不是结论：避免玩家还没布完就被"布防完成"带节奏直接开跑
      hintText = '布防完成了吗？点「开始降雨」';
    }
  }

  const hint = hintText;

  return (
    <div className="app">
      <FloodScene sim={sim} tool={tool} speed={speed} onStats={handleStats} onPlace={handlePlace} />

      <div className="hud">
        {/* 很淡的暗角：把视线往中间收，画面不至于"平" */}
        <div className="vignette" />
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
          nudge={placed}
          speed={speed}
          onSpeed={setSpeed}
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

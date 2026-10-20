import { useCallback, useEffect, useRef, useState } from 'react';
import FloodScene from './scene/FloodScene';
import Hud from './ui/Hud';
import Toolbar from './ui/Toolbar';
import Overlay from './ui/Overlay';
import Legend from './ui/Legend';
import ResultPanel from './ui/ResultPanel';
import ScenarioBar from './ui/ScenarioBar';
import { GameSim } from './sim/game';
import { SCENARIOS } from './sim/scenarios';
import type { ScenarioId } from './sim/scenarios';
import type { PlaceResult, Stats, Tool } from './sim/game';

export default function App() {
  const [sim] = useState(() => new GameSim('canyon'));
  const [stats, setStats] = useState<Stats>(() => sim.stats());
  const [scenarioId, setScenarioId] = useState<ScenarioId>('canyon');
  const [tool, setTool] = useState<Tool>('levee');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);

  const scenario = SCENARIOS[scenarioId];

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const handleStats = useCallback((next: Stats) => setStats(next), []);

  const handlePlace = useCallback(
    (result: PlaceResult) => {
      if (!result.ok && result.reason) showToast(result.reason);
      setStats(sim.stats());
    },
    [sim, showToast],
  );

  const handleStart = useCallback(() => {
    sim.start();
    setStats(sim.stats());
  }, [sim]);

  const handleReset = useCallback(() => {
    sim.reset();
    setStats(sim.stats());
    setTool('levee');
    setToast('');
  }, [sim]);

  const handleScenario = useCallback(
    (id: ScenarioId) => {
      if (id === sim.scenarioId) return;
      sim.loadScenario(id);
      setScenarioId(id);
      setStats(sim.stats());
      setTool('levee');
      setToast('');
    },
    [sim],
  );

  const hint =
    stats.phase === 'prepare'
      ? tool === 'levee'
        ? '点击变电站周围，把场地垫高到洪水位以上'
        : '点击低洼处布置水泵，会持续抽水'
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

          <div className="dim">拖动旋转 · 滚轮缩放 · 点击施工</div>
          <div className="warn">⚠ 物理过程为简化模型，仅用于视觉演示，非工程精度</div>

          <div className="meta">
            预算 {scenario.budget} · 时长 {scenario.duration}s · 网格 {(112 * 112 / 1000).toFixed(1)}k
          </div>
        </div>

        <Hud stats={stats} />

        <ResultPanel stats={stats} />

        <Toolbar
          phase={stats.phase}
          tool={tool}
          onTool={setTool}
          onStart={handleStart}
          onReset={handleReset}
        />

        <Legend />
        <div className={`hint ${toast ? 'alert' : ''}`}>{toast || hint}</div>
      </div>

      <Overlay stats={stats} onReset={handleReset} />
    </div>
  );
}

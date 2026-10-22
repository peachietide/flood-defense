/**
 * 游戏状态机。与 React、three.js 完全解耦：
 * 渲染层每帧调用 step()，UI 层读取 stats()。
 *
 * 地形与降雨参数来自场景（scenarios.ts）。
 */

import { computeNormals, generateTerrain, N } from './terrain';
import { addRain, stepWater } from './water';
import { SCENARIOS, buildRainCurve, DEFAULT_RAIN_SCALE } from './scenarios';
import type { Scenario, ScenarioId } from './scenarios';

export type Phase = 'prepare' | 'running' | 'over';
export type Tool = 'levee' | 'pump';

/** 与场景无关的全局规则 */
export const CFG = {
  leveeCost: 120,
  pumpCost: 200,
  leveeRadius: 4,
  leveeHeight: 3.2,
  pumpRadius: 4,
  /** 水泵额定流量，m³/s（固定流量，不随浸水面积变化） */
  pumpFlow: 90,
  /** 泵房进水超过这个深度就停机 */
  pumpFloodDepth: 1.0,
  /** 超过这个水深算"被淹" */
  floodThreshold: 0.25,
  /** 水深超过这个值才开始损伤设施（约膝盖深，肉眼能看到进水） */
  damageDepth: 0.45,
  /** 曼宁糙率，用于流速估算（洪泛区带植被） */
  manning: 0.045,
} as const;

/** 四个过程指标（工程上真正看的量） */
export interface Metric {
  /** 最大水深，m */
  depth: number;
  /** 最大流速，m/s */
  speed: number;
  /** 累计淹没历时，s */
  duration: number;
  /** 首次淹没时刻，s；-1 表示未淹没 */
  arrival: number;
  /** 是否被淹过 */
  flooded: boolean;
}

/** 一条剖面线的数据（沿 x 方向，穿过变电站所在行） */
export interface ProfileSample {
  /** 地面高程 */
  ground: number[];
  /** 水面高程（无水处等于地面） */
  surface: number[];
  /** 变电站在这条剖面上的位置（索引） */
  facilityIndex: number;
}

export interface Stats {
  phase: Phase;
  scenarioId: ScenarioId;
  budget: number;
  hp: number;
  timeLeft: number;
  duration: number;
  floodedPct: number;
  won: boolean;
  pumpCount: number;
  /** 变电站处的指标 */
  site: Metric;
  /** 全域极值 */
  domain: Metric;
  /** 已模拟时长 */
  elapsed: number;
  /** 穿过变电站的横剖面 */
  profile: ProfileSample;
  /** 归一化雨型曲线（均值 1） */
  rainCurve: Float32Array;
  /** 当前雨强倍率（相对峰值） */
  rainNow: number;
  /** 进度 0~1 */
  progress: number;
  /** 降雨重现期倍率 */
  rainScale: number;
  /** 已被淹停机的泵数 */
  pumpFlooded: number;
}

export interface PlaceResult {
  ok: boolean;
  reason?: string;
}

export class GameSim {
  scenarioId: ScenarioId = 'canyon';
  scenario: Scenario = SCENARIOS.canyon;

  height!: Float32Array;
  depth!: Float32Array;
  wet!: Float32Array;
  normals!: Float32Array;
  rainMask!: Float32Array;
  facility!: { cx: number; cz: number };

  phase: Phase = 'prepare';
  budget = 1000;
  hp = 100;
  timeLeft = 60;
  floodedPct = 0;
  won = false;
  pumps: Array<{ x: number; z: number; flooded: boolean }> = [];

  /** 逐单元的过程指标（工程上真正关心的四个量） */
  maxDepth = new Float32Array(N * N);
  maxSpeed = new Float32Array(N * N);
  floodTime = new Float32Array(N * N);
  /** 首次淹没的时刻（秒），-1 表示从未淹没 */
  arrival = new Float32Array(N * N).fill(-1);
  /** 已模拟的时间（秒） */
  elapsed = 0;

  /** 归一化雨型曲线（均值 1），长度 101 */
  rainCurve: Float32Array = buildRainCurve('flat');
  /** 当前雨强倍率，用于 UI 显示 */
  rainNow = 1;
  /** 降雨重现期倍率（相对场景基准雨强） */
  rainScale = DEFAULT_RAIN_SCALE;

  private delta = new Float32Array(N * N);

  constructor(id: ScenarioId = 'canyon') {
    this.loadScenario(id);
  }

  loadScenario(id: ScenarioId): void {
    this.scenarioId = id;
    this.scenario = SCENARIOS[id];
    this.rainScale = DEFAULT_RAIN_SCALE;
    this.reset();
  }

  reset(): void {
    const s = this.scenario;
    this.rainCurve = buildRainCurve(s.rainShape);
    this.rainNow = 1;
    const terrain = generateTerrain(s.terrain);
    this.height = terrain.height;
    this.normals = terrain.normals;
    this.rainMask = terrain.rainMask;
    this.facility = terrain.facility;
    this.depth = new Float32Array(N * N);
    this.wet = new Float32Array(N * N);
    this.delta.fill(0);

    this.maxDepth.fill(0);
    this.maxSpeed.fill(0);
    this.floodTime.fill(0);
    this.arrival.fill(-1);
    this.elapsed = 0;

    this.phase = 'prepare';
    this.budget = s.budget;
    this.hp = 100;
    this.timeLeft = s.duration;
    this.floodedPct = 0;
    this.won = false;
    this.pumps = [];
  }

  start(): void {
    if (this.phase === 'prepare') this.phase = 'running';
  }

  /** 推进一帧。dt 为秒。 */
  step(dt: number): void {
    const wasRunning = this.phase === 'running';

    if (wasRunning) {
      const s = this.scenario;
      this.timeLeft -= dt;
      this.elapsed += dt;

      // 雨强按雨型曲线随时间变化（曲线均值已归一到 1，总雨量不变）
      const u = this.elapsed / s.duration;
      const last = this.rainCurve.length - 1;
      const pos = Math.max(0, Math.min(last, u * last));
      const i0 = Math.floor(pos);
      const i1 = Math.min(last, i0 + 1);
      const t = pos - i0;
      const factor = this.rainCurve[i0] + (this.rainCurve[i1] - this.rainCurve[i0]) * t;
      this.rainNow = factor;

      addRain(this.depth, this.rainMask, s.rainRate * factor * this.rainScale, dt);

      for (const p of this.pumps) {
        // 泵房自己进水就停机——所以水泵必须放在地势较高处
        const pi = p.z * N + p.x;
        p.flooded = this.depth[pi] > CFG.pumpFloodDepth;
        if (p.flooded) continue;

        const r = CFG.pumpRadius;
        const z0 = Math.max(0, p.z - r);
        const z1 = Math.min(N - 1, p.z + r);
        const x0 = Math.max(0, p.x - r);
        const x1 = Math.min(N - 1, p.x + r);

        // 先数一下半径内有多少"有水的格子"
        let area = 0;
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz > r * r) continue;
            if (this.depth[z * N + x] > 0.01) area++;
          }
        }
        if (area === 0) continue;

        // 固定流量：总抽水量 Q·dt 摊到所有湿格上。
        // 浸水面积越大，每格水位降得越慢——这就是"抽不赢"。
        // 再加一个单格降速上限：真实泵受来水补给限制，不可能把一小片水瞬间抽干。
        const drop = Math.min(1.0 * dt, (CFG.pumpFlow * dt) / area);
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz > r * r) continue;
            const i = z * N + x;
            this.depth[i] = Math.max(0, this.depth[i] - drop);
          }
        }
      }

      stepWater(this.height, this.depth, this.delta, dt * 0.5);
      stepWater(this.height, this.depth, this.delta, dt * 0.5);

      const fi = this.facility.cz * N + this.facility.cx;
      if (this.depth[fi] > CFG.damageDepth) {
        this.hp -= s.damageRate * dt;
      }

      if (this.hp <= 0) {
        this.hp = 0;
        this.phase = 'over';
        this.won = false;
      } else if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.phase = 'over';
        this.won = true;
      }
    }

    // 湿润着色 + 淹没统计 + 四项过程指标
    let flooded = 0;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const d = this.depth[i];

        if (d > 0.05) {
          this.wet[i] = Math.min(1, this.wet[i] + dt * 0.6);
        } else if (this.wet[i] > 0) {
          this.wet[i] = Math.max(0, this.wet[i] - dt * 0.18);
        }

        if (d <= CFG.floodThreshold) continue;
        flooded++;
        if (!wasRunning) continue;

        if (d > this.maxDepth[i]) this.maxDepth[i] = d;
        if (this.arrival[i] < 0) this.arrival[i] = this.elapsed;
        this.floodTime[i] += dt;

        // 流速用曼宁公式估算：v = (1/n)·R^(2/3)·S^(1/2)
        // R 取水深，S 取与四邻域水面高差的最大值（每格 1 m，即无量纲比降）。
        // 水面比降做 2% 封顶：局部陡坎（尤其干湿交界）会算出几十 m/s 的假值。
        const surface = this.height[i] + d;
        let slope = 0;
        if (x > 0) slope = Math.max(slope, surface - (this.height[i - 1] + this.depth[i - 1]));
        if (x < N - 1) slope = Math.max(slope, surface - (this.height[i + 1] + this.depth[i + 1]));
        if (z > 0) slope = Math.max(slope, surface - (this.height[i - N] + this.depth[i - N]));
        if (z < N - 1) slope = Math.max(slope, surface - (this.height[i + N] + this.depth[i + N]));

        if (slope > 0) {
          const s = Math.min(slope, 0.02);
          const v = Math.min(10, (1 / CFG.manning) * Math.pow(d, 2 / 3) * Math.sqrt(s));
          if (v > this.maxSpeed[i]) this.maxSpeed[i] = v;
        }
      }
    }
    this.floodedPct = (flooded / (N * N)) * 100;
  }

  placeLevee(cx: number, cz: number): PlaceResult {
    if (this.phase !== 'prepare') return { ok: false, reason: '已经开始降雨了' };
    if (this.budget < CFG.leveeCost) return { ok: false, reason: '预算不足' };

    this.budget -= CFG.leveeCost;
    const r = CFG.leveeRadius;
    for (let z = Math.max(0, cz - r); z <= Math.min(N - 1, cz + r); z++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(N - 1, cx + r); x++) {
        const dx = x - cx;
        const dz = z - cz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > r) continue;
        const w = 1 - d / r;
        this.height[z * N + x] += CFG.leveeHeight * (0.35 + 0.65 * w);
      }
    }
    computeNormals(this.height, this.normals);
    return { ok: true };
  }

  placePump(cx: number, cz: number): PlaceResult {
    if (this.phase !== 'prepare') return { ok: false, reason: '已经开始降雨了' };
    if (this.budget < CFG.pumpCost) return { ok: false, reason: '预算不足' };
    this.budget -= CFG.pumpCost;
    this.pumps.push({ x: cx, z: cz, flooded: false });
    return { ok: true };
  }

  /** 设置降雨重现期倍率。只能在布防阶段改，避免中途改雨强造成结果失真。 */
  setRainScale(scale: number): PlaceResult {
    if (this.phase !== 'prepare') return { ok: false, reason: '已经开始降雨了' };
    this.rainScale = scale;
    return { ok: true };
  }

  /** 单个单元的指标 */
  private metricAt(i: number): Metric {
    return {
      depth: this.maxDepth[i],
      speed: this.maxSpeed[i],
      duration: this.floodTime[i],
      arrival: this.arrival[i],
      flooded: this.arrival[i] >= 0,
    };
  }

  /** 全域极值：最大水深、最大流速、最长淹没历时、最早到达时间 */
  private domainMetric(): Metric {
    let depth = 0;
    let speed = 0;
    let duration = 0;
    let arrival = -1;
    for (let i = 0; i < N * N; i++) {
      if (this.maxDepth[i] > depth) depth = this.maxDepth[i];
      if (this.maxSpeed[i] > speed) speed = this.maxSpeed[i];
      if (this.floodTime[i] > duration) duration = this.floodTime[i];
      const a = this.arrival[i];
      if (a >= 0 && (arrival < 0 || a < arrival)) arrival = a;
    }
    return { depth, speed, duration, arrival, flooded: arrival >= 0 };
  }

  /** 穿过变电站所在行的横剖面 */
  private profileAtFacilityRow(): ProfileSample {
    const z = this.facility.cz;
    const ground: number[] = new Array(N);
    const surface: number[] = new Array(N);
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const h = this.height[i];
      ground[x] = h;
      surface[x] = h + this.depth[i];
    }
    return { ground, surface, facilityIndex: this.facility.cx };
  }

  stats(): Stats {
    const fi = this.facility.cz * N + this.facility.cx;
    return {
      phase: this.phase,
      scenarioId: this.scenarioId,
      budget: this.budget,
      hp: this.hp,
      timeLeft: this.timeLeft,
      duration: this.scenario.duration,
      floodedPct: this.floodedPct,
      won: this.won,
      pumpCount: this.pumps.length,
      pumpFlooded: this.pumps.reduce((n, p) => n + (p.flooded ? 1 : 0), 0),
      site: this.metricAt(fi),
      domain: this.domainMetric(),
      elapsed: this.elapsed,
      profile: this.profileAtFacilityRow(),
      rainCurve: this.rainCurve,
      rainNow: this.rainNow,
      progress: Math.max(0, Math.min(1, this.elapsed / this.scenario.duration)),
      rainScale: this.rainScale,
    };
  }

  /** 变电站处的实时水深 */
  facilityDepth(): number {
    return this.depth[this.facility.cz * N + this.facility.cx];
  }
}

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
export type Tool = 'levee' | 'pump' | 'ring';

/** 与场景无关的全局规则 */
export const CFG = {
  leveeCost: 120,
  pumpCost: 200,
  leveeRadius: 4,
  leveeHeight: 3.2,
  pumpRadius: 4,
  /** 水泵额定流量，m³/s（固定流量，不随浸水面积变化） */
  pumpFlow: 8,
  /** 泵房进水超过这个深度就停机 */
  pumpFloodDepth: 1.0,
  /** 布置水泵允许的最大地面高差（米）：超过就是陡坡，泵站放不了。
   *  自然地形每格坡降最多约 2 m（峡谷洼地边缘），围堰墙面是 5～6 m，取 3 m 作分界。 */
  pumpMaxSlope: 3.0,

  /** 围堰：绕厂址围一圈挡水的土堰 */
  ringCost: 200,
  /** 围堰内半径（格） */
  ringInner: 5.0,
  /** 围堰外半径（格）。厚度必须 ≥2.5 格：单格厚的斜向围墙在四邻域里会漏水 */
  ringOuter: 7.7,
  /** 围堰高出沿线地面最高点的超高 */
  ringFreeboard: 2.6,
  /** 围堰施工点距变电站中心的最大格数 */
  ringMaxDistance: 12,
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
  /** 是否已围堰 */
  hasRing: boolean;
  /** 下一次加高的价格（随已抬次数递增，工具栏要显示和判断） */
  nextLeveeCost: number;
  /** 已经加高了几次（吸附之后就等于厂址处的抬升次数） */
  leveeCount: number;
  /** 本局已经花掉的钱 */
  spent: number;
  /** 成本评级：A = 接近最低可行，B = 守住了但花多了 */
  grade: 'A' | 'B';
  /** 本场景守住所需的最低花费（评级基准） */
  parCost: number;
  /** 厂坪当前水深 */
  siteDepthNow: number;  /** 洪峰是否已过（水位开始回落） */
  peakPassed: boolean;
}

export interface PlaceResult {
  ok: boolean;
  reason?: string;
  /** 实际花费（加高的成本随位置递增，不再是固定值） */
  cost?: number;
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
  /** 每个位置被抬高过几次，用来计算加高的边际成本 */
  raiseCount = new Float32Array(N * N);
  /** 是否已围堰 */
  hasRing = false;
  /** 淹没面积的历史峰值（判断洪峰用） */
  private peakFloodedPct = 0;
  /** 淹没面积开始低于峰值 90% 的时刻，-1 表示还没开始退 */
  private recedeSince = -1;
  /** 洪峰是否已过 */
  peakPassed = false;
  /** 已模拟的时间（秒） */
  elapsed = 0;

  /** 归一化雨型曲线（均值 1），长度 101 */
  rainCurve: Float32Array = buildRainCurve('flat');
  /** 雨型曲线的峰值，用于判断"后面还有没有大雨" */
  private rainCurveMax = 1;
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
    this.rainCurveMax = this.rainCurve.reduce((a, b) => Math.max(a, b), 0) || 1;
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
    this.raiseCount.fill(0);
    this.hasRing = false;
    this.peakFloodedPct = 0;
    this.recedeSince = -1;
    this.peakPassed = false;
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
        // 统计半径内的总水量（每格按 1 m² 计）
        let volume = 0;
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz > r * r) continue;
            volume += this.depth[z * N + x];
          }
        }
        if (volume <= 1e-4) continue;

        // 按"水量比例"抽：总抽水量 Q·dt 固定，水深的地方少得多、浅的地方少得少。
        // 以前的写法是把 Q·dt 平均摊到湿格上，导致"泵越靠近岸边（湿格越少）越有劲"——
        // 园区里 49 个格只有 6 个能赢，玩家看不出为什么。
        const removed = Math.min(CFG.pumpFlow * dt, volume * 0.5);
        const k = removed / volume;
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz > r * r) continue;
            const i = z * N + x;
            this.depth[i] *= 1 - k;
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
    let curMax = 0;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const d = this.depth[i];
        if (d > curMax) curMax = d;

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

    // 洪峰是否已过：用"淹没面积"判断，而不是全域最大水深。
    // 最大水深被河道最深的一格钉死（峡谷 14.8 m 几乎不降），用它会导致
    // 峡谷永远不触发、平原要等到 80 秒（90 秒的局）才触发。
    // 淹没面积直接反映"水在退"，并且要求持续 6 秒，防止双峰雨型误判。
    if (wasRunning) {
      if (this.floodedPct > this.peakFloodedPct) this.peakFloodedPct = this.floodedPct;
      const belowTail = this.floodedPct < this.peakFloodedPct * 0.96;
      if (!belowTail) {
        this.recedeSince = -1;
      } else if (this.recedeSince < 0) {
        this.recedeSince = this.elapsed;
      } else if (
        !this.peakPassed &&
        this.peakFloodedPct > 10 &&
        this.elapsed > this.scenario.duration * 0.25 &&
        this.elapsed - this.recedeSince >= 3 &&
        // 后面还有大雨就不用报"洪峰已过"：双峰雨型的第一段小回落会误判
        this.rainAheadFactor() < 0.5 * this.rainCurveMax
      ) {
        this.peakPassed = true;
      }

      // 兜底：过了 60% 的时长、后面的雨已经不大了，就认为最危险的阶段过去了。
      // 有些工况（比如围堰刚好扛住 100 年）全域水位一直在涨到结束，
      // 靠"面积回落"永远等不到提示，但玩家其实已经安全了。
      if (
        !this.peakPassed &&
        this.peakFloodedPct > 10 &&
        this.elapsed > this.scenario.duration * 0.6 &&
        this.rainAheadFactor() < 0.5 * this.rainCurveMax
      ) {
        this.peakPassed = true;
      }
    }
  }

  /** 本局的评级基准：100 年一遇下便宜方案不够用，基准要抬高 */
  private parForThisRun(): number {
    return this.rainScale > 1.0 ? this.scenario.parCostExtreme : this.scenario.parCost;
  }

  /** 未来 15% 局时长内的最大雨强倍率（雨型曲线已知，可以"看后面的雨"） */
  private rainAheadFactor(): number {
    const n = this.rainCurve.length - 1;
    const u0 = Math.max(0, Math.min(1, this.elapsed / this.scenario.duration));
    const u1 = Math.min(1, u0 + 0.15);
    const i0 = Math.round(u0 * n);
    const i1 = Math.round(u1 * n);
    let best = 0;
    for (let i = i0; i <= i1; i++) if (this.rainCurve[i] > best) best = this.rainCurve[i];
    return best;
  }

  placeLevee(cx: number, cz: number): PlaceResult {
    if (this.phase !== 'prepare') return { ok: false, reason: '降雨已开始' };

    const r = CFG.leveeRadius;
    const fx = this.facility.cx;
    const fz = this.facility.cz;
    const dist = Math.hypot(cx - fx, cz - fz);

    // 允许范围就是加高半径本身：落在半径内，厂址中心一定能被抬到（只是强弱不同）；
    // 超出半径布置就是纯白花钱，直接拒绝——不能做成"能点但无效"的隐形陷阱。
    if (dist > r) {
      return { ok: false, reason: '距离变电站过远，无法抬升厂址——请点击厂址附近' };
    }

    // 峡谷地形起伏大、厂址在深坑里很难瞄准，给一点吸附；
    // 平原/园区地面平坦、目标清晰，保留玩家自己选点的操作感（snapRadius = 0）。
    const snap = this.scenario.terrain.snapRadius;
    const snapped = snap > 0 && dist <= snap;
    const px = snapped ? fx : cx;
    const pz = snapped ? fz : cz;

    // 成本按"厂址处已抬次数"递增：120 → 240 → 360 …
    // 对应真实工程里土方量随填高非线性增长。
    const level = this.raiseCount[fz * N + fx];
    const cost = Math.round(this.scenario.leveeCost * (1 + level));
    if (this.budget < cost) return { ok: false, reason: `预算不足（需 ${cost}）` };

    this.budget -= cost;
    for (let z = Math.max(0, pz - r); z <= Math.min(N - 1, pz + r); z++) {
      for (let x = Math.max(0, px - r); x <= Math.min(N - 1, px + r); x++) {
        const dx = x - px;
        const dz = z - pz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > r) continue;
        const w = 1 - d / r;
        this.height[z * N + x] += CFG.leveeHeight * (0.35 + 0.65 * w);
        this.raiseCount[z * N + x] += 1;
      }
    }
    computeNormals(this.height, this.normals);
    return { ok: true, cost };
  }

  /**
   * 围堰：绕厂址围一圈挡水的土堰。
   * 它挡住堤外的洪水，但堤内的本地降雨排不出去——所以必须配水泵。
   */
  placeRing(cx: number, cz: number): PlaceResult {
    if (this.phase !== 'prepare') return { ok: false, reason: '降雨已开始' };
    if (this.hasRing) return { ok: false, reason: '围堰已建成' };

    const d = Math.hypot(cx - this.facility.cx, cz - this.facility.cz);
    if (d > CFG.ringMaxDistance) return { ok: false, reason: '距离过远，请靠近变电站' };
    if (this.budget < CFG.ringCost) return { ok: false, reason: `预算不足（需 ${CFG.ringCost}）` };

    this.budget -= CFG.ringCost;
    this.hasRing = true;

    const fx = this.facility.cx;
    const fz = this.facility.cz;
    const span = Math.ceil(CFG.ringOuter) + 2;

    // 堰顶高程按"围堰沿线地面的最高点"再抬一个超高，而不是按厂坪算。
    // 厂坪往往低于周边地面（facilityDrop），按厂坪算会让堰顶埋进地里，
    // 围堰反而变成一个存水的坑。
    let crestY = -Infinity;
    for (let z = Math.max(0, fz - span); z <= Math.min(N - 1, fz + span); z++) {
      for (let x = Math.max(0, fx - span); x <= Math.min(N - 1, fx + span); x++) {
        const dd = Math.hypot(x - fx, z - fz);
        if (dd < CFG.ringInner || dd > CFG.ringOuter) continue;
        const h = this.height[z * N + x];
        if (h > crestY) crestY = h;
      }
    }
    crestY += CFG.ringFreeboard;

    for (let z = Math.max(0, fz - span); z <= Math.min(N - 1, fz + span); z++) {
      for (let x = Math.max(0, fx - span); x <= Math.min(N - 1, fx + span); x++) {
        const dd = Math.hypot(x - fx, z - fz);
        if (dd < CFG.ringInner || dd > CFG.ringOuter) continue;
        const i = z * N + x;
        if (this.height[i] < crestY) this.height[i] = crestY;
      }
    }
    computeNormals(this.height, this.normals);
    return { ok: true, cost: CFG.ringCost };
  }

  placePump(cx: number, cz: number): PlaceResult {
    if (this.phase !== 'prepare') return { ok: false, reason: '降雨已开始' };

    // 陡坡上不能布置水泵：一是工程上泵站需要平整场地，
    // 二是围堰墙面一格就抬升 6 米，放在坡面上的泵会显示成"悬在半空"。
    const i = cz * N + cx;
    const h = this.height[i];
    let maxDiff = 0;
    if (cx > 0) maxDiff = Math.max(maxDiff, Math.abs(this.height[i - 1] - h));
    if (cx < N - 1) maxDiff = Math.max(maxDiff, Math.abs(this.height[i + 1] - h));
    if (cz > 0) maxDiff = Math.max(maxDiff, Math.abs(this.height[i - N] - h));
    if (cz < N - 1) maxDiff = Math.max(maxDiff, Math.abs(this.height[i + N] - h));
    if (maxDiff > CFG.pumpMaxSlope) {
      return { ok: false, reason: '坡面过陡，水泵需要平整场地' };
    }

    if (this.budget < CFG.pumpCost) return { ok: false, reason: '预算不足' };
    this.budget -= CFG.pumpCost;
    this.pumps.push({ x: cx, z: cz, flooded: false });
    return { ok: true, cost: CFG.pumpCost };
  }

  /** 设置降雨重现期倍率。只能在布防阶段改，避免中途改雨强造成结果失真。 */
  setRainScale(scale: number): PlaceResult {
    if (this.phase !== 'prepare') return { ok: false, reason: '降雨已开始' };
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
      hasRing: this.hasRing,
      nextLeveeCost: Math.round(
        this.scenario.leveeCost * (1 + this.raiseCount[this.facility.cz * N + this.facility.cx]),
      ),
      leveeCount: Math.round(this.raiseCount[this.facility.cz * N + this.facility.cx]),
      spent: this.scenario.budget - this.budget,
      grade: this.scenario.budget - this.budget <= this.parForThisRun() * 1.08 ? 'A' : 'B',
      parCost: Math.round(this.parForThisRun()),
      siteDepthNow: this.depth[this.facility.cz * N + this.facility.cx],
      peakPassed: this.peakPassed,
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

/**
 * 游戏状态机。与 React、three.js 完全解耦：
 * 渲染层每帧调用 step()，UI 层读取 stats()。
 *
 * 地形与降雨参数来自场景（scenarios.ts）。
 */

import { computeNormals, generateTerrain, N } from './terrain';
import { addRain, stepWater } from './water';
import { SCENARIOS } from './scenarios';
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
  pumpRate: 0.9,
  /** 超过这个水深算"被淹" */
  floodThreshold: 0.25,
} as const;

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
  pumps: Array<{ x: number; z: number }> = [];

  private delta = new Float32Array(N * N);

  constructor(id: ScenarioId = 'canyon') {
    this.loadScenario(id);
  }

  loadScenario(id: ScenarioId): void {
    this.scenarioId = id;
    this.scenario = SCENARIOS[id];
    this.reset();
  }

  reset(): void {
    const s = this.scenario;
    const terrain = generateTerrain(s.terrain);
    this.height = terrain.height;
    this.normals = terrain.normals;
    this.rainMask = terrain.rainMask;
    this.facility = terrain.facility;
    this.depth = new Float32Array(N * N);
    this.wet = new Float32Array(N * N);
    this.delta.fill(0);

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
    if (this.phase === 'running') {
      const s = this.scenario;
      this.timeLeft -= dt;

      addRain(this.depth, this.rainMask, s.rainRate, dt);

      for (const p of this.pumps) {
        const r = CFG.pumpRadius;
        const z0 = Math.max(0, p.z - r);
        const z1 = Math.min(N - 1, p.z + r);
        const x0 = Math.max(0, p.x - r);
        const x1 = Math.min(N - 1, p.x + r);
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz > r * r) continue;
            const i = z * N + x;
            this.depth[i] = Math.max(0, this.depth[i] - CFG.pumpRate * dt);
          }
        }
      }

      stepWater(this.height, this.depth, this.delta, dt * 0.5);
      stepWater(this.height, this.depth, this.delta, dt * 0.5);

      const fi = this.facility.cz * N + this.facility.cx;
      if (this.depth[fi] > CFG.floodThreshold) {
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

    // 湿润着色 + 淹没统计（每帧都更新，结算后水面保持）
    let flooded = 0;
    for (let i = 0; i < N * N; i++) {
      const d = this.depth[i];
      if (d > 0.05) {
        this.wet[i] = Math.min(1, this.wet[i] + dt * 0.6);
      } else if (this.wet[i] > 0) {
        this.wet[i] = Math.max(0, this.wet[i] - dt * 0.18);
      }
      if (d > CFG.floodThreshold) flooded++;
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
    this.pumps.push({ x: cx, z: cz });
    return { ok: true };
  }

  stats(): Stats {
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
    };
  }

  /** 变电站处的实时水深 */
  facilityDepth(): number {
    return this.depth[this.facility.cz * N + this.facility.cx];
  }
}

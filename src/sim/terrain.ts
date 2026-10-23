/**
 * 地形生成：噪声丘陵 + 蜿蜒河道 + 河滩台地 + 降雨权重。
 * 纯计算，不依赖 three.js 或 DOM。
 *
 * 地形形态由场景配置驱动，见 scenarios.ts。
 */

import type { TerrainConfig } from './scenarios';

export const N = 112;
export const CELL = 1;
export const MAX_HEIGHT = 18;

export interface Terrain {
  /** 高程，长度 N*N，行优先（index = z * N + x） */
  height: Float32Array;
  /** 顶点法线，xyz 交错 */
  normals: Float32Array;
  /** 降雨权重：上游集水区为 1，下游厂址附近为 0 */
  rainMask: Float32Array;
  /** 变电站所在网格 */
  facility: { cx: number; cz: number };
}

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number): number {
  let s = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    s += smoothNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return s / norm;
}

/** 河道中心线（沿 z 方向蜿蜒） */
export function riverX(z: number, meander: number): number {
  return N * 0.5 + Math.sin(z * 0.042) * meander + Math.sin(z * 0.11) * meander * 0.3;
}

export function computeNormals(height: Float32Array, out: Float32Array): void {
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const hl = height[z * N + Math.max(0, x - 1)];
      const hr = height[z * N + Math.min(N - 1, x + 1)];
      const hd = height[Math.max(0, z - 1) * N + x];
      const hu = height[Math.min(N - 1, z + 1) * N + x];
      const nx = (hl - hr) * 0.5;
      const ny = 2.0;
      const nz = (hd - hu) * 0.5;
      const len = Math.hypot(nx, ny, nz) || 1;
      out[i * 3] = nx / len;
      out[i * 3 + 1] = ny / len;
      out[i * 3 + 2] = nz / len;
    }
  }
}

export function generateTerrain(cfg: TerrainConfig): Terrain {
  const height = new Float32Array(N * N);
  const normals = new Float32Array(N * N * 3);
  const rainMask = new Float32Array(N * N);

  // 1) 基础地形：噪声丘陵 + 沿 z 的整体坡降 + 河谷下切
  for (let z = 0; z < N; z++) {
    const rx = riverX(z, cfg.meander);
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      // 地面向 +z 方向倾斜：上游（z 小）高、下游（z 大）低。
      // 雨落在上游集水区，洪水顺坡演进到下游厂址。
      let h = cfg.baseHeight + fbm(x * 0.045, z * 0.045) * cfg.relief - (z / N) * cfg.slope;
      const d = Math.abs(x - rx);
      h -= cfg.valleyDepth * Math.exp(-(d * d) / (2 * cfg.valleyWidth * cfg.valleyWidth));
      h -= cfg.channelDepth * Math.exp(-(d * d) / (2 * cfg.channelWidth * cfg.channelWidth));
      height[i] = h;
    }
  }

  // 2) 厂址台地：平整改造成一块场地，比原地低（低洼场地）
  const fz = Math.floor(N * 0.8);
  const fx = Math.round(riverX(fz, cfg.meander)) + cfg.facilityOffset;
  const facility = { cx: fx, cz: fz };
  const base = height[fz * N + fx] + cfg.facilityDrop;
  const fr = cfg.facilityRadius;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const dx = x - fx;
      const dz = z - fz;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r < fr) {
        const w = Math.max(0, 1 - r / fr);
        const i = z * N + x;
        height[i] = height[i] * (1 - w * 0.88) + base * (w * 0.88);
      }
    }
  }

  // 3) 降雨权重：雨只落在上游集水区，向下游逐渐归零。
  //    这样洪水以波的形式演进到厂址，而不是"场地上下雨把自己淹了"。
  let hmin = Infinity;
  let hmax = -Infinity;
  for (let i = 0; i < N * N; i++) {
    if (height[i] < hmin) hmin = height[i];
    if (height[i] > hmax) hmax = height[i];
  }
  const range = Math.max(1e-6, hmax - hmin);
  const rainStart = cfg.catchmentEnd - 0.12;
  for (let z = 0; z < N; z++) {
    const tz = z / N;
    let zf = 1 - Math.max(0, Math.min(1, (tz - rainStart) / 0.12));
    zf = zf * zf * (3 - 2 * zf);
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const t = Math.max(0, Math.min(1, (height[i] - hmin) / range));
      rainMask[i] = zf * (0.35 + 0.65 * t);
    }
  }

  // 场地本地降雨：厂址附近保留一部分直接降雨。
  // 真实的厂址内涝主要来自"落在自己头上的雨"，而不是远处的洪水。
  // 有了这一项，场地上的水才需要靠排水泵解决——否则水泵无事可做。
  const localAmp = 0.3;
  const localSigma = 13;
  const inv2s2 = 1 / (2 * localSigma * localSigma);
  for (let z = 0; z < N; z++) {
    const dz = z - facility.cz;
    for (let x = 0; x < N; x++) {
      const dx = x - facility.cx;
      const local = localAmp * Math.exp(-(dx * dx + dz * dz) * inv2s2);
      const i = z * N + x;
      if (local > rainMask[i]) rainMask[i] = local;
    }
  }

  computeNormals(height, normals);
  return { height, normals, rainMask, facility };
}

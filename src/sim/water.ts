/**
 * 水面演进：四邻域元胞自动机。
 * 这是"看起来像洪水"的关键，不是二维水动力方程——精度只够做交互演示。
 */

import { N } from './terrain';

/**
 * 一步水量重分配。
 * @param height 地面高程
 * @param depth  水深（原地更新）
 * @param delta  临时差分缓冲（复用，避免每帧分配）
 */
export function stepWater(
  height: Float32Array,
  depth: Float32Array,
  delta: Float32Array,
  dt: number,
): void {
  delta.fill(0);
  const flow = Math.min(1, dt * 9.0);

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const d = depth[i];
      if (d < 1e-5) continue;

      const s = height[i] + d;
      const hasL = x > 0;
      const hasR = x < N - 1;
      const hasD = z > 0;
      const hasU = z < N - 1;

      let g0 = 0;
      let g1 = 0;
      let g2 = 0;
      let g3 = 0;
      let w0 = 0;
      let w1 = 0;
      let w2 = 0;
      let w3 = 0;

      // 只向更低处流；用 1.5 次方让陡坡获得更多流量
      if (hasL) {
        g0 = s - (height[i - 1] + depth[i - 1]);
        if (g0 > 0) w0 = g0 * Math.sqrt(g0);
      }
      if (hasR) {
        g1 = s - (height[i + 1] + depth[i + 1]);
        if (g1 > 0) w1 = g1 * Math.sqrt(g1);
      }
      if (hasD) {
        g2 = s - (height[i - N] + depth[i - N]);
        if (g2 > 0) w2 = g2 * Math.sqrt(g2);
      }
      if (hasU) {
        g3 = s - (height[i + N] + depth[i + N]);
        if (g3 > 0) w3 = g3 * Math.sqrt(g3);
      }

      const total = w0 + w1 + w2 + w3;
      if (total <= 0) continue;

      const capacity = d * flow;
      let rem = capacity;

      if (w0 > 0) {
        const out = Math.min((capacity * w0) / total, g0 * 0.5, rem);
        if (out > 0) {
          rem -= out;
          delta[i] -= out;
          delta[i - 1] += out;
        }
      }
      if (w1 > 0) {
        const out = Math.min((capacity * w1) / total, g1 * 0.5, rem);
        if (out > 0) {
          rem -= out;
          delta[i] -= out;
          delta[i + 1] += out;
        }
      }
      if (w2 > 0) {
        const out = Math.min((capacity * w2) / total, g2 * 0.5, rem);
        if (out > 0) {
          rem -= out;
          delta[i] -= out;
          delta[i - N] += out;
        }
      }
      if (w3 > 0) {
        const out = Math.min((capacity * w3) / total, g3 * 0.5, rem);
        if (out > 0) {
          rem -= out;
          delta[i] -= out;
          delta[i + N] += out;
        }
      }
    }
  }

  for (let i = 0; i < N * N; i++) {
    const v = depth[i] + delta[i];
    depth[i] = v > 0 ? v : 0;
  }

  // 计算域边界开口，水流出
  for (let x = 0; x < N; x++) {
    depth[x] *= 0.55;
    depth[(N - 1) * N + x] *= 0.55;
  }
  for (let z = 0; z < N; z++) {
    depth[z * N] *= 0.55;
    depth[z * N + N - 1] *= 0.55;
  }
}

/** 按降雨权重加水 */
export function addRain(
  depth: Float32Array,
  rainMask: Float32Array,
  rate: number,
  dt: number,
): void {
  const amount = rate * dt;
  for (let i = 0; i < N * N; i++) {
    depth[i] += amount * rainMask[i];
  }
}

/**
 * 场景定义：每个场景对应一类真实客户和一种水文响应。
 *
 * 设计原则：场景差异要体现在**水文行为**上，不能只是换个地形贴图。
 * 峡谷 = 汇流快、峰高、预警时间短；
 * 平原 = 淹没广、水浅、历时长；
 * 园区 = 地面平、产流快、场地在洼地。
 */

export type ScenarioId = 'canyon' | 'plain' | 'urban';

export interface TerrainConfig {
  /** 基底高程 */
  baseHeight: number;
  /** 丘陵起伏幅度 */
  relief: number;
  /** 沿 z 方向的整体坡降 */
  slope: number;
  /** 河谷下切深度 */
  valleyDepth: number;
  /** 河谷宽度（高斯 σ） */
  valleyWidth: number;
  /** 河道深槽深度 */
  channelDepth: number;
  /** 河道深槽宽度 */
  channelWidth: number;
  /** 河道蜿蜒振幅 */
  meander: number;
  /** 厂址距河道中心的格数 */
  facilityOffset: number;
  /** 厂址台地与原地面的高差（负值 = 低洼场地） */
  facilityDrop: number;
  /** 厂址台地半径 */
  facilityRadius: number;
  /** 降雨区结束位置（0~1），之后不再下雨 */
  catchmentEnd: number;
}

export interface Scenario {
  id: ScenarioId;
  /** 场景名 */
  name: string;
  /** 对应客户类型 */
  customer: string;
  /** 一句话描述 */
  description: string;
  /** 这个场景的难点 */
  challenge: string;
  terrain: TerrainConfig;
  /** 降雨峰值强度 */
  rainRate: number;
  /** 雨型：决定雨强随时间的分布 */
  rainShape: RainShape;
  /** 一局时长（秒） */
  duration: number;
  /** 初始预算 */
  budget: number;
  /** 设施被淹时每秒损失的完好度 */
  damageRate: number;
}

/** 雨型：真实暴雨不是恒定强度，而是有起势、峰值和消退 */
export type RainShape = 'flat' | 'peak' | 'front' | 'double';

function gauss(u: number, mu: number, sigma: number): number {
  const d = u - mu;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

/** 无量纲雨型（未归一化） */
function shapeAt(shape: RainShape, u: number): number {
  switch (shape) {
    case 'peak':
      // 单峰，峰在 45% 处
      return gauss(u, 0.45, 0.18);
    case 'front':
      // 前峰型：先猛后缓，尾部还有一次小回升
      return 0.95 * gauss(u, 0.18, 0.13) + 0.35 * gauss(u, 0.62, 0.14);
    case 'double':
      // 双峰型：两场雨间隔落下
      return 0.85 * gauss(u, 0.28, 0.09) + 0.85 * gauss(u, 0.62, 0.09);
    case 'flat':
    default:
      return 1;
  }
}

/**
 * 生成归一化雨型曲线：采样 101 点，均值归一到 1。
 * 这样换成任何雨型，总雨量都和恒定降雨相同，平衡不会被改坏。
 */
export function buildRainCurve(shape: RainShape, samples = 101): Float32Array {
  const curve = new Float32Array(samples);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const v = shapeAt(shape, u);
    curve[i] = v;
    sum += v;
  }
  const mean = sum / samples || 1;
  for (let i = 0; i < samples; i++) curve[i] /= mean;
  return curve;
}

export const SCENARIO_ORDER: ScenarioId[] = ['canyon', 'plain', 'urban'];

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  canyon: {
    id: 'canyon',
    name: '峡谷',
    customer: '山区核电厂址',
    description: '窄深河谷，短历时暴雨。洪水来得快、退得也快。',
    challenge: '汇流时间极短，留给你布防的时间很少',
    terrain: {
      baseHeight: 6,
      relief: 14,
      slope: 11,
      valleyDepth: 16,
      valleyWidth: 7,
      channelDepth: 4,
      channelWidth: 3.5,
      meander: 9,
      facilityOffset: 11,
      facilityDrop: -7.5,
      facilityRadius: 5,
      catchmentEnd: 0.52,
    },
    rainRate: 0.115,
    rainShape: 'peak',
    duration: 45,
    budget: 450,
    damageRate: 12,
  },

  plain: {
    id: 'plain',
    name: '平原',
    customer: '变电站 / 蓄滞洪区',
    description: '宽浅河谷，长历时降雨。水不深，但淹得很广。',
    challenge: '淹没范围大，防线长，预算铺不满',
    terrain: {
      baseHeight: 4,
      relief: 6,
      slope: 3,
      valleyDepth: 6,
      valleyWidth: 26,
      channelDepth: 1.5,
      channelWidth: 4,
      meander: 20,
      facilityOffset: 12,
      facilityDrop: -1.6,
      facilityRadius: 7,
      catchmentEnd: 0.60,
    },
    rainRate: 0.068,
    rainShape: 'front',
    duration: 90,
    budget: 430,
    damageRate: 7,
  },

  urban: {
    id: 'urban',
    name: '园区',
    customer: '算力中心 / 工业园区',
    description: '地势平坦，硬化地面多。雨水几乎全部变成径流。',
    challenge: '产流快、场地在洼地，排水能力有限',
    terrain: {
      baseHeight: 4,
      relief: 3.2,
      slope: 2,
      valleyDepth: 8,
      valleyWidth: 18,
      channelDepth: 2,
      channelWidth: 4,
      meander: 7,
      facilityOffset: 11,
      facilityDrop: -2.2,
      facilityRadius: 6,
      catchmentEnd: 0.70,
    },
    rainRate: 0.098,
    rainShape: 'double',
    duration: 60,
    budget: 450,
    damageRate: 10,
  },
};

export function getScenario(id: ScenarioId): Scenario {
  return SCENARIOS[id];
}

/**
 * 降雨重现期预设。
 * 工程上用"多少年一遇"表达雨强，比给一个裸数字更直观。
 * scale 是相对场景基准雨强的倍率。
 */
export interface RainPreset {
  id: string;
  /** 按钮文字 */
  label: string;
  /** 相对基准雨强的倍率 */
  scale: number;
  /** 说明，用于悬停提示 */
  note: string;
}

export const RAIN_PRESETS: RainPreset[] = [
  { id: 'p5', label: '5 年', scale: 0.55, note: '常遇洪水，场地基本安全' },
  { id: 'p20', label: '20 年', scale: 0.8, note: '一般设计标准附近' },
  { id: 'p50', label: '50 年', scale: 1.0, note: '场景基准工况' },
  { id: 'p100', label: '100 年', scale: 1.35, note: '校核工况，接近极端' },
];

/** 默认预设（50 年一遇，倍率 1.0，与原有平衡一致） */
export const DEFAULT_RAIN_SCALE = 1.0;

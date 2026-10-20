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
  /** 降雨强度 */
  rainRate: number;
  /** 一局时长（秒） */
  duration: number;
  /** 初始预算 */
  budget: number;
  /** 设施被淹时每秒损失的完好度 */
  damageRate: number;
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
      facilityOffset: 5,
      facilityDrop: -3.2,
      facilityRadius: 5,
      catchmentEnd: 0.52,
    },
    rainRate: 0.115,
    duration: 45,
    budget: 1000,
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
    duration: 90,
    budget: 1000,
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
      facilityOffset: 6,
      facilityDrop: -2.2,
      facilityRadius: 6,
      catchmentEnd: 0.70,
    },
    rainRate: 0.098,
    duration: 60,
    budget: 1000,
    damageRate: 10,
  },
};

export function getScenario(id: ScenarioId): Scenario {
  return SCENARIOS[id];
}

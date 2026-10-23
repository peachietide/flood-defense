/**
 * 试玩埋点：把玩家在一次会话里的关键行为记下来，存本地，可导出。
 *
 * 设计原则：
 * - 不采集任何个人信息（没有 IP、没有设备指纹、没有账号）
 * - 全部存在浏览器 localStorage，不上传
 * - 只记录"能用来改产品"的事件，不记录逐帧数据
 *
 * 用途：回答"玩家在哪里卡住、哪个工具有人用、难度是否合适"，
 * 而不是靠问卷里"挺好的"这种回答。
 */

const STORAGE_KEY = 'flood-defense.telemetry.v1';
const MAX_SESSIONS = 50;

export interface TelemetryEvent {
  /** 相对会话开始的毫秒数 */
  at: number;
  type: string;
  data?: Record<string, string | number | boolean>;
}

export interface SessionRecord {
  id: string;
  startedAt: string;
  scenario: string;
  rainScale: number;
  events: TelemetryEvent[];
  summary?: {
    won: boolean;
    hp: number;
    budget: number;
    elapsed: number;
    floodedPct: number;
    pumps: number;
    pumpsFlooded: number;
  };
}

let current: SessionRecord | null = null;
let zero: number = 0;
let firstActionDone = false;

/**
 * localStorage 不可用时（隐私模式、file:// 限制、配额满）的内存副本。
 * 有它兜底，即使用不了存储，本次会话的记录仍然能导出——
 * 总比"按钮永远是灰的"好。
 */
let memorySessions: SessionRecord[] = [];
let memoryOnly = false;

function readAll(): SessionRecord[] {
  if (memoryOnly) return memorySessions.slice();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return memorySessions.slice();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionRecord[]) : [];
  } catch {
    memoryOnly = true;
    return memorySessions.slice();
  }
}

function writeAll(list: SessionRecord[]): void {
  const capped = list.slice(-MAX_SESSIONS);
  memorySessions = capped;
  if (memoryOnly) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // 隐私模式或配额满：降级为内存模式，不影响游戏本身
    memoryOnly = true;
  }
}

function persist(): void {
  if (!current) return;
  const all = readAll().filter((s) => s.id !== current!.id);
  all.push(current);
  writeAll(all);
}

/** 开始一次会话（页面加载时调用一次） */
export function beginSession(scenario: string, rainScale: number): void {
  current = {
    id: Math.random().toString(36).slice(2, 10),
    startedAt: new Date().toISOString(),
    scenario,
    rainScale,
    events: [],
  };
  zero = typeof performance !== 'undefined' ? performance.now() : Date.now();
  firstActionDone = false;
  track('session_start');
}

/** 记录一个事件 */
export function track(type: string, data?: Record<string, string | number | boolean>): void {
  if (!current) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  current.events.push({ at: Math.round(now - zero), type, data });
  persist();
}

/**
 * 记录"第一次动手"。只记一次，用来衡量界面好不好懂：
 * 从页面打开到玩家做出第一个操作花了多久。
 */
export function trackFirstAction(kind: string): void {
  if (firstActionDone) return;
  firstActionDone = true;
  track('first_action', { kind });
}

/** 记录一局的结果。一局只调用一次。 */
export function trackResult(summary: SessionRecord['summary']): void {
  if (!current || !summary) return;
  current.summary = summary;
  track('result', {
    won: summary.won,
    hp: Math.round(summary.hp),
    budget: summary.budget,
    elapsed: Math.round(summary.elapsed),
  });
}

/** 是否有可导出的记录 */
export function hasTelemetry(): boolean {
  const all = readAll();
  if (all.length === 0) return false;
  return true;
}

/** 会话总数（用于界面上显示"已有 N 条记录"） */
export function sessionCount(): number {
  return readAll().length;
}

/** 导出全部记录为 JSON 字符串 */
export function exportJson(): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), sessions: readAll() },
    null,
    2,
  );
}

/** 触发浏览器下载 */
export function downloadJson(): void {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flood-defense-telemetry-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 清空全部记录（给测试用） */
export function clearAll(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

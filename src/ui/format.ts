/** 展示用的格式化工具 */

export function fmtTime(s: number): string {
  if (s < 0) return '—';
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
}

export function fmtDepth(v: number): string {
  return v < 0.005 ? '0.00' : v.toFixed(2);
}

export function fmtSpeed(v: number): string {
  return v < 0.01 ? '—' : v.toFixed(2);
}

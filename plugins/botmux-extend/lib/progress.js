const pad = (n) => String(n).padStart(2, '0');

/**
 * 生成"当前进展"字段的内容：`[MM-DD HH:mm] 状态：说明`，固定东八区，避免多主机时区不一致。
 * @param {string} status
 * @param {string} note
 * @param {Date} now
 */
export function formatProgress(status, note, now) {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  const stamp = `${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  return `[${stamp}] ${status}：${note}`;
}

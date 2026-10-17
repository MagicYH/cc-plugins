const pad = (n) => String(n).padStart(2, '0');

/**
 * 生成"当前进展"字段的内容：`[MM-DD HH:mm] 状态：说明`，按本机时区。
 * @param {string} status
 * @param {string} note
 * @param {Date} now
 */
export function formatProgress(status, note, now) {
  const stamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `[${stamp}] ${status}：${note}`;
}

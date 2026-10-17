// 看板上的固定取值，与多维表格里的单选选项一一对应。
export const Status = Object.freeze({
  PENDING: '待分配',
  IN_PROGRESS: '进行中',
  BLOCKED: '阻塞',
  DONE: '已完成',
});

// `muxboard status` 允许设置的状态（待分配只由 add 产生）。
export const SETTABLE_STATUSES = [Status.IN_PROGRESS, Status.BLOCKED, Status.DONE];

export const PRIORITIES = ['高', '中', '低'];
export const DEFAULT_PRIORITY = '中';

// 建群时一次最多拉入的人数（lark-cli +chat-create --users 的上限）。
export const MAX_CHAT_USERS = 50;

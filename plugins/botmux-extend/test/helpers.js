// 测试共用的假对象。各测试文件按需覆盖其中的方法。

/** 记录调用参数、按顺序返回预设结果的假 lark runner。 */
export function fakeRunner(responses = []) {
  const calls = [];
  const queue = [...responses];
  const run = async (args) => {
    calls.push(args);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(args) : next;
  };
  return { run, calls };
}

/** 测试用的固定时间：2026-10-17 15:30（本机时区）。 */
export const fixedNow = () => new Date(2026, 9, 17, 15, 30);

/** 组装命令的 ctx。board / chat 传部分实现即可。 */
export function makeCtx({ board = {}, chat = {}, env = {} } = {}) {
  return {
    board,
    chat,
    env: { appId: 'cli_self', chatId: 'oc_current', ownerOpenId: 'ou_owner', ...env },
    now: fixedNow,
  };
}

/** 生成一个完整的 Task 对象，便于在测试里只写关心的字段。 */
export function task(overrides = {}) {
  return {
    task_id: 'recTask',
    title: '任务',
    desc: null,
    criteria: null,
    priority: '中',
    status: '进行中',
    owner: 'cli_self',
    progress: null,
    output: null,
    work_chat: null,
    parent_id: null,
    dispatcher: null,
    updated_at: null,
    ...overrides,
  };
}

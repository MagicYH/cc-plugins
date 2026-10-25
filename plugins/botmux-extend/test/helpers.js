// 测试共用的假对象。各测试文件按需覆盖其中的方法。
import assert from 'node:assert/strict';

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

/** 测试用的固定时间：2026-10-17 15:30（东八区），即 07:30 UTC。 */
export const fixedNow = () => new Date(Date.UTC(2026, 9, 17, 7, 30));

/** 组装命令的 ctx。board / chat 传部分实现即可。 */
export function makeCtx({ board = {}, boardUrl = null, provisionBoard, chat = {}, env = {} } = {}) {
  return {
    board,
    boardUrl,
    provisionBoard: provisionBoard ?? (async () => assert.fail('不应新建看板')),
    chat,
    env: { appId: 'cli_self', chatId: 'oc_current', ownerOpenId: 'ou_owner', hostname: 'host-a', ...env },
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
    hostname: null,
    deps: [],
    ...overrides,
  };
}

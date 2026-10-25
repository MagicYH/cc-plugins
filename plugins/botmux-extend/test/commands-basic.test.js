import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run as init } from '../lib/commands/init.js';
import { run as show } from '../lib/commands/show.js';
import { run as start } from '../lib/commands/start.js';
import { run as children } from '../lib/commands/children.js';
import { run as output } from '../lib/commands/output.js';
import { makeCtx, task } from './helpers.js';

const FLAGS = { title: '登录功能', desc: '参考文档 https://x', criteria: '接口通过联调' };

/** 普通群的假 chat；info 可覆盖 getInfo 的返回值。 */
const groupChat = (info = {}) => ({
  getInfo: async () => ({ name: '群', chat_mode: 'group', group_message_type: 'chat', ...info }),
});

/** 记录 createTask 调用的假 board。 */
function recordingBoard() {
  const created = [];
  return { created, board: { createTask: async (patch) => (created.push(patch), 'recNew') } };
}

test('init 写入任务字段，工作群是当前群，派发人优先用 --from', async () => {
  const { created, board } = recordingBoard();
  const ctx = makeCtx({ board, chat: groupChat() });
  const result = await init({ positionals: [], flags: { ...FLAGS, from: 'ou_sender' } }, ctx);

  assert.deepEqual(result, { task_id: 'recNew', chat_id: 'oc_current', url: null });
  assert.deepEqual(created[0], {
    title: '登录功能',
    desc: '参考文档 https://x',
    criteria: '接口通过联调',
    priority: '中',
    status: '进行中',
    owner: 'cli_self',
    progress: '[10-17 15:30] 进行中：创建任务',
    work_chat_id: 'oc_current',
    hostname: 'host-a',
    dispatcher_open_id: 'ou_sender',
  });
});

test('init 没有 --from 时用 ownerOpenId 作为派发人', async () => {
  const { created, board } = recordingBoard();
  await init({ positionals: [], flags: { ...FLAGS, priority: '高' } }, makeCtx({ board, chat: groupChat() }));
  assert.equal(created[0].dispatcher_open_id, 'ou_owner');
  assert.equal(created[0].priority, '高');
});

test('init 派发人都没有时不写 dispatcher_open_id', async () => {
  const { created, board } = recordingBoard();
  const ctx = makeCtx({ board, chat: groupChat(), env: { ownerOpenId: undefined } });
  await init({ positionals: [], flags: FLAGS }, ctx);
  assert.equal('dispatcher_open_id' in created[0], false);
});

test('init 已有看板时直接使用，把看板链接发到当前群并在输出里带上', async () => {
  const { created, board } = recordingBoard();
  const sent = [];
  const chat = { ...groupChat(), send: async (chatId, text) => (sent.push({ chatId, text }), 'om_1') };
  const ctx = makeCtx({ board, boardUrl: 'https://x.feishu.cn/base/basA', chat });

  const result = await init({ positionals: [], flags: FLAGS }, ctx);

  assert.equal(created.length, 1);
  assert.deepEqual(result, { task_id: 'recNew', chat_id: 'oc_current', url: 'https://x.feishu.cn/base/basA' });
  assert.deepEqual(sent, [{
    chatId: 'oc_current',
    text: '已创建根任务「登录功能」（recNew），任务看板：https://x.feishu.cn/base/basA',
  }]);
});

test('init 没有看板时先新建，再在新看板上创建根任务并发链接', async () => {
  const { created, board } = recordingBoard();
  const sent = [];
  let provisioned = 0;
  const ctx = makeCtx({
    board: null,
    provisionBoard: async () => (provisioned++, { board, url: 'https://x.feishu.cn/base/basNew' }),
    chat: { ...groupChat(), send: async (chatId, text) => (sent.push(text), 'om_1') },
  });

  const result = await init({ positionals: [], flags: FLAGS }, ctx);

  assert.equal(provisioned, 1);
  assert.equal(created.length, 1);
  assert.equal(result.url, 'https://x.feishu.cn/base/basNew');
  assert.match(sent[0], /任务看板：https:\/\/x\.feishu\.cn\/base\/basNew$/);
});

test('init 没有看板且当前不是普通群时，不新建看板', async () => {
  const ctx = makeCtx({ board: null, chat: groupChat({ chat_mode: 'topic' }) });
  await assert.rejects(init({ positionals: [], flags: FLAGS }, ctx), { code: 'not_group_chat' });
});

test('init 单聊时抛 not_group_chat，不读群信息也不写看板', async () => {
  const ctx = makeCtx({
    board: { createTask: async () => assert.fail('不应调用') },
    chat: { getInfo: async () => assert.fail('不应调用') },
    env: { chatType: 'p2p' },
  });
  await assert.rejects(init({ positionals: [], flags: FLAGS }, ctx), { code: 'not_group_chat' });
});

test('init 读不到群模式（群已解散或 bot 不在群里）时抛 not_group_chat', async () => {
  const ctx = makeCtx({ board: { createTask: async () => assert.fail('不应调用') }, chat: groupChat({ chat_mode: null }) });
  await assert.rejects(init({ positionals: [], flags: FLAGS }, ctx), (err) => err.code === 'not_group_chat' && err.message.includes('已解散'));
});

test('init 话题群（chat_mode=topic）时抛 not_group_chat', async () => {
  const ctx = makeCtx({ board: { createTask: async () => assert.fail('不应调用') }, chat: groupChat({ chat_mode: 'topic' }) });
  await assert.rejects(init({ positionals: [], flags: FLAGS }, ctx), { code: 'not_group_chat' });
});

test('init 话题模式群（group_message_type=thread）时抛 not_group_chat', async () => {
  const ctx = makeCtx({
    board: { createTask: async () => assert.fail('不应调用') },
    chat: groupChat({ group_message_type: 'thread' }),
  });
  await assert.rejects(init({ positionals: [], flags: FLAGS }, ctx), { code: 'not_group_chat' });
});

test('init 缺少 BOTMUX_CHAT_ID 时抛 not_in_botmux', async () => {
  const ctx = makeCtx({ board: { createTask: async () => assert.fail('不应调用') }, chat: groupChat(), env: { chatId: undefined } });
  await assert.rejects(init({ positionals: [], flags: FLAGS }, ctx), { code: 'not_in_botmux' });
});

test('init 缺少必填参数时抛 invalid_args', async () => {
  const ctx = makeCtx({ board: { createTask: async () => assert.fail('不应调用') } });
  await assert.rejects(
    init({ positionals: [], flags: { title: 'a', desc: 'b' } }, ctx),
    { code: 'invalid_args' },
  );
});

test('init 优先级不合法时抛 invalid_args', async () => {
  const ctx = makeCtx({ board: { createTask: async () => assert.fail('不应调用') } });
  await assert.rejects(
    init({ positionals: [], flags: { ...FLAGS, priority: '紧急' } }, ctx),
    { code: 'invalid_args' },
  );
});

test('show 返回详情，并统计子任务数量', async () => {
  const ctx = makeCtx({
    board: {
      getTask: async (id) => task({ task_id: id, title: '用户系统', status: '进行中', hostname: 'host-b' }),
      listChildren: async () => [
        task({ task_id: 'recA', status: '已完成' }),
        task({ task_id: 'recB', status: '进行中' }),
        task({ task_id: 'recC', status: '已完成' }),
      ],
    },
  });
  const data = await show({ positionals: ['recParent'], flags: {} }, ctx);
  assert.equal(data.task_id, 'recParent');
  assert.equal(data.hostname, 'host-b');
  assert.equal(data.parent, null);
  assert.deepEqual(data.children, { total: 3, done: 2 });
});

test('show 有父任务时返回父任务摘要', async () => {
  const ctx = makeCtx({
    board: {
      getTask: async (id) => {
        if (id === 'recChild') return task({ task_id: id, parent_id: 'recRoot' });
        return task({ task_id: 'recRoot', title: '根', owner: 'cli_root', status: '阻塞' });
      },
      listChildren: async () => [],
    },
  });
  const data = await show({ positionals: ['recChild'], flags: {} }, ctx);
  assert.deepEqual(data.parent, { task_id: 'recRoot', title: '根', owner: 'cli_root', status: '阻塞' });
  assert.deepEqual(data.children, { total: 0, done: 0 });
});

test('show 任务不存在时抛出 board 的错误', async () => {
  const ctx = makeCtx({
    board: { getTask: async () => { throw Object.assign(new Error('x'), { code: 'not_found' }); } },
  });
  await assert.rejects(show({ positionals: ['recNone'], flags: {} }, ctx), { code: 'not_found' });
});

test('show 缺少任务 ID 时抛 invalid_args', async () => {
  await assert.rejects(show({ positionals: [], flags: {} }, makeCtx()), { code: 'invalid_args' });
});

test('start 待分配的任务改为进行中并写进展', async () => {
  const updates = [];
  const ctx = makeCtx({
    board: {
      getTask: async () => task({ status: '待分配' }),
      updateTask: async (id, patch) => updates.push([id, patch]),
    },
  });
  const data = await start({ positionals: ['recT'], flags: {} }, ctx);
  assert.deepEqual(data, { task_id: 'recT', status: '进行中' });
  assert.deepEqual(updates, [
    ['recT', { status: '进行中', progress: '[10-17 15:30] 进行中：开始处理', hostname: 'host-a' }],
  ]);
});

test('start 非待分配状态不做任何更新', async () => {
  const updates = [];
  const ctx = makeCtx({
    board: {
      getTask: async () => task({ status: '阻塞' }),
      updateTask: async (...args) => updates.push(args),
    },
  });
  const data = await start({ positionals: ['recT'], flags: {} }, ctx);
  assert.deepEqual(data, { task_id: 'recT', status: '阻塞' });
  assert.equal(updates.length, 0);
});

test('start 任务不存在时抛出 board 的错误', async () => {
  const ctx = makeCtx({
    board: { getTask: async () => { throw Object.assign(new Error('x'), { code: 'not_found' }); } },
  });
  await assert.rejects(start({ positionals: ['recNone'], flags: {} }, ctx), { code: 'not_found' });
});

test('children 返回子任务列表并透传 status 过滤', async () => {
  const calls = [];
  const ctx = makeCtx({
    board: {
      getTask: async () => task(),
      listChildren: async (...args) => {
        calls.push(args);
        return [task({ task_id: 'recA', title: '子', owner: 'cli_x', status: '进行中', progress: 'p', output: null, updated_at: 'u', hostname: 'host-b' })];
      },
    },
  });
  const data = await children({ positionals: ['recP'], flags: { status: '进行中' } }, ctx);
  assert.deepEqual(calls, [['recP', { status: '进行中' }]]);
  assert.deepEqual(data, {
    children: [{
      task_id: 'recA', title: '子', priority: '中', owner: 'cli_x', status: '进行中', deps: [], ready: false,
      progress: 'p', output: null, updated_at: 'u', hostname: 'host-b',
    }],
  });
});

/** children 调度用例的子任务列表：创建顺序 A→E。 */
function scheduleList() {
  return [
    task({ task_id: 'recA', status: '已完成', priority: '高', owner: 'cli_1' }),
    task({ task_id: 'recB', status: '待分配', priority: '低', owner: null, deps: ['recA'] }),
    task({ task_id: 'recC', status: '待分配', priority: '高', owner: null, deps: ['recD'] }),
    task({ task_id: 'recD', status: '进行中', priority: '中', owner: 'cli_2' }),
    task({ task_id: 'recE', status: '待分配', priority: '高', owner: null }),
    task({ task_id: 'recF', status: '待分配', priority: '高', owner: 'cli_3' }),
  ];
}

test('children 计算 ready，并按 ready → 优先级 → 创建顺序排序', async () => {
  const ctx = makeCtx({ board: { getTask: async () => task(), listChildren: async () => scheduleList() } });
  const data = await children({ positionals: ['recP'], flags: {} }, ctx);
  // ready：E（高）、B（低，依赖 A 已完成）；C 依赖 D 未完成；F 已派发未开始
  assert.deepEqual(data.children.map((c) => [c.task_id, c.ready]), [
    ['recE', true], ['recB', true],
    ['recA', false], ['recC', false], ['recF', false], ['recD', false],
  ]);
  assert.deepEqual(data.children.find((c) => c.task_id === 'recB').deps, ['recA']);
});

test('children --ready 只输出可派发的子任务', async () => {
  const ctx = makeCtx({ board: { getTask: async () => task(), listChildren: async () => scheduleList() } });
  const data = await children({ positionals: ['recP'], flags: { ready: 'true' } }, ctx);
  assert.deepEqual(data.children.map((c) => c.task_id), ['recE', 'recB']);
});

test('children 带 --status 时，不在列表里的依赖单独查询状态', async () => {
  const queried = [];
  const ctx = makeCtx({
    board: {
      getTask: async (id) => (queried.push(id), task({ task_id: id, status: id === 'recA' ? '已完成' : '进行中' })),
      listChildren: async () => [task({ task_id: 'recB', status: '待分配', owner: null, deps: ['recA'] })],
    },
  });
  const data = await children({ positionals: ['recP'], flags: { status: '待分配' } }, ctx);
  assert.deepEqual(queried, ['recP', 'recA']);
  assert.equal(data.children[0].ready, true);
});

test('children 没传 --status 时不带过滤条件', async () => {
  const calls = [];
  const ctx = makeCtx({
    board: {
      getTask: async () => task(),
      listChildren: async (...args) => (calls.push(args), []),
    },
  });
  await children({ positionals: ['recP'], flags: {} }, ctx);
  assert.deepEqual(calls, [['recP']]);
});

test('children 状态不合法时抛 invalid_status', async () => {
  const ctx = makeCtx({ board: { getTask: async () => task(), listChildren: async () => assert.fail('不应调用') } });
  await assert.rejects(children({ positionals: ['recP'], flags: { status: '完成' } }, ctx), { code: 'invalid_status' });
});

test('output 写入产出字段', async () => {
  const updates = [];
  const ctx = makeCtx({
    board: {
      getTask: async () => task(),
      updateTask: async (id, patch) => updates.push([id, patch]),
    },
  });
  const data = await output({ positionals: ['recT', 'https://mr/1'], flags: {} }, ctx);
  assert.deepEqual(data, { task_id: 'recT' });
  assert.deepEqual(updates, [['recT', { output: 'https://mr/1', hostname: 'host-a' }]]);
});

test('output 缺少内容时抛 invalid_args，且不写入', async () => {
  const ctx = makeCtx({ board: { getTask: async () => task(), updateTask: async () => assert.fail('不应调用') } });
  await assert.rejects(output({ positionals: ['recT'], flags: {} }, ctx), { code: 'invalid_args' });
});

test('output 任务不存在时抛出 board 的错误且不写入', async () => {
  const ctx = makeCtx({
    board: {
      getTask: async () => { throw Object.assign(new Error('x'), { code: 'not_found' }); },
      updateTask: async () => assert.fail('不应调用'),
    },
  });
  await assert.rejects(output({ positionals: ['recNone', 'x'], flags: {} }, ctx), { code: 'not_found' });
});

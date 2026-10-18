// add / split / assign / status 四个命令的流程测试。board 和 chat 都是假对象，不调用 lark-cli。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, task } from './helpers.js';
import { run as add } from '../lib/commands/add.js';
import { run as split } from '../lib/commands/split.js';
import { run as assign } from '../lib/commands/assign.js';
import { run as status } from '../lib/commands/status.js';
import { Status } from '../lib/constants.js';
import { formatDescription } from '../lib/workchat.js';

/** 按 taskId 查的假 board，记录 updateTask / createTask 调用。 */
function fakeBoard(tasks, { children = [] } = {}) {
  const updates = [];
  const created = [];
  return {
    updates,
    created,
    board: {
      async getTask(id) {
        const t = tasks[id];
        if (!t) throw Object.assign(new Error('not found'), { code: 'not_found' });
        return t;
      },
      async listChildren() {
        return children;
      },
      async createTask(patch) {
        created.push(patch);
        return 'recNew';
      },
      async updateTask(id, patch) {
        updates.push({ id, patch });
      },
    },
  };
}

/** 假 chat，记录 create / send / addBots 调用。 */
function fakeChat({ members = { users: [], bots: [] } } = {}) {
  const calls = { create: [], send: [], addBots: [] };
  return {
    calls,
    chat: {
      async create(opts) {
        calls.create.push(opts);
        return 'oc_new';
      },
      async listMembers() {
        return members;
      },
      async addBots(chatId, appIds) {
        calls.addBots.push({ chatId, appIds });
      },
      async send(chatId, text) {
        calls.send.push({ chatId, text });
        return 'om_1';
      },
    },
  };
}

// ---------- add ----------

const addArgs = (parentId, flags = {}) => ({
  positionals: [parentId],
  flags: { title: '子标题', desc: '描述', criteria: '验收', ...flags },
});

test('add: 在父任务的工作群下建子任务，不建群', async () => {
  const parent = task({ task_id: 'recP', title: '父', work_chat: { chat_id: 'oc_work', name: '群' } });
  const { board, created, updates } = fakeBoard({ recP: parent });
  const { chat, calls } = fakeChat();

  const data = await add(addArgs('recP', { priority: '高' }), makeCtx({ board, chat }));

  assert.deepEqual(data, { task_id: 'recNew', chat_id: 'oc_work' });
  assert.deepEqual(created, [
    {
      title: '子标题',
      desc: '描述',
      criteria: '验收',
      priority: '高',
      status: Status.PENDING,
      parent_id: 'recP',
    },
  ]);
  assert.equal(calls.create.length, 0);
  assert.equal(updates.length, 0);
});

test('add: 父任务没有工作群时抛 no_work_chat 并提示先 split，不建子任务', async () => {
  const parent = task({ task_id: 'recP', title: '子任务A', parent_id: 'recR' });
  const { board, created } = fakeBoard({ recP: parent });
  const { chat, calls } = fakeChat();

  await assert.rejects(
    add(addArgs('recP'), makeCtx({ board, chat })),
    (err) => err.code === 'no_work_chat' && err.message.includes('muxboard split recP'),
  );
  assert.equal(calls.create.length, 0);
  assert.equal(created.length, 0);
});

test('add: 优先级不合法时抛 invalid_args', async () => {
  const { board } = fakeBoard({});
  await assert.rejects(
    add(addArgs('recP', { priority: '紧急' }), makeCtx({ board })),
    { code: 'invalid_args' },
  );
});

// ---------- split ----------

test('split: 新建群，拉入上级群的人和 bot（不含自己），写回工作群并发说明消息', async () => {
  const root = task({ task_id: 'recR', title: '总任务', work_chat: { chat_id: 'oc_root', name: null } });
  const child = task({ task_id: 'recC', title: '子任务A', parent_id: 'recR' });
  const { board, updates } = fakeBoard({ recR: root, recC: child });
  const { chat, calls } = fakeChat({
    members: {
      users: [{ open_id: 'ou_a' }, { open_id: 'ou_b' }],
      bots: [{ app_id: 'cli_self' }, { app_id: 'cli_beta' }, { app_id: 'cli_zero' }],
    },
  });

  const data = await split({ positionals: ['recC'], flags: {} }, makeCtx({ board, chat }));

  assert.deepEqual(data, { task_id: 'recC', chat_id: 'oc_new', chat_created: true, bots: ['cli_beta', 'cli_zero'] });
  assert.deepEqual(calls.create, [
    {
      name: '总任务 - 子任务A',
      description: formatDescription({ taskId: 'recC', upperChatId: 'oc_root' }),
      userOpenIds: ['ou_a', 'ou_b'],
    },
  ]);
  assert.deepEqual(calls.addBots, [{ chatId: 'oc_new', appIds: ['cli_beta', 'cli_zero'] }]);
  assert.deepEqual(updates, [{ id: 'recC', patch: { work_chat_id: 'oc_new' } }]);
  assert.equal(calls.send[0].chatId, 'oc_new');
  assert.match(calls.send[0].text, /本群是任务「子任务A」（recC）的工作群，上级群：oc_root/);
});

test('split: 三级任务的群名用根任务标题，上级群取父任务的工作群，人数最多 50', async () => {
  const users = Array.from({ length: 60 }, (_, i) => ({ open_id: `ou_${i}` }));
  const root = task({ task_id: 'recR', title: '总任务', work_chat: { chat_id: 'oc_root', name: null } });
  const mid = task({ task_id: 'recM', title: '中间任务', parent_id: 'recR', work_chat: { chat_id: 'oc_mid', name: null } });
  const leaf = task({ task_id: 'recL', title: '叶子任务', parent_id: 'recM' });
  const { board } = fakeBoard({ recR: root, recM: mid, recL: leaf });
  const { chat, calls } = fakeChat({ members: { users, bots: [] } });

  await split({ positionals: ['recL'], flags: {} }, makeCtx({ board, chat }));

  assert.equal(calls.create[0].name, '总任务 - 叶子任务');
  assert.equal(calls.create[0].description, formatDescription({ taskId: 'recL', upperChatId: 'oc_mid' }));
  assert.equal(calls.create[0].userOpenIds.length, 50);
});

test('split: 已有工作群时不重复建群', async () => {
  const child = task({ task_id: 'recC', parent_id: 'recR', work_chat: { chat_id: 'oc_c', name: null } });
  const { board, updates } = fakeBoard({ recC: child });
  const { chat, calls } = fakeChat();

  const data = await split({ positionals: ['recC'], flags: {} }, makeCtx({ board, chat }));

  assert.deepEqual(data, { task_id: 'recC', chat_id: 'oc_c', chat_created: false, bots: [] });
  assert.equal(calls.create.length, 0);
  assert.equal(updates.length, 0);
});

test('split: 根任务抛 invalid_args', async () => {
  const root = task({ task_id: 'recR', work_chat: { chat_id: 'oc_root', name: null } });
  const { board } = fakeBoard({ recR: root });
  const { chat, calls } = fakeChat();

  await assert.rejects(
    split({ positionals: ['recR'], flags: {} }, makeCtx({ board, chat })),
    { code: 'invalid_args' },
  );
  assert.equal(calls.create.length, 0);
});

test('split: 父任务没有工作群时抛 no_work_chat，不建群', async () => {
  const parent = task({ task_id: 'recP', parent_id: 'recR' });
  const child = task({ task_id: 'recC', parent_id: 'recP' });
  const { board } = fakeBoard({ recP: parent, recC: child });
  const { chat, calls } = fakeChat();

  await assert.rejects(
    split({ positionals: ['recC'], flags: {} }, makeCtx({ board, chat })),
    { code: 'no_work_chat' },
  );
  assert.equal(calls.create.length, 0);
});

// ---------- assign ----------

test('assign: 正常路径写入负责人、拉 bot 入群，并 @ bot 发送两条命令', async () => {
  const parent = task({ task_id: 'recP', title: '父', work_chat: { chat_id: 'oc_work', name: null } });
  const child = task({ task_id: 'recC', title: '子', parent_id: 'recP' });
  const { board, updates } = fakeBoard({ recP: parent, recC: child });
  const { chat, calls } = fakeChat({
    members: {
      users: [],
      bots: [{ app_id: 'cli_bot', open_id: 'ou_bot', name: '小助手' }],
    },
  });

  const data = await assign({ positionals: ['recC'], flags: { bot: 'cli_bot' } }, makeCtx({ board, chat }));

  assert.deepEqual(data, { task_id: 'recC', owner: 'cli_bot', message_id: 'om_1' });
  assert.deepEqual(updates, [{ id: 'recC', patch: { owner: 'cli_bot' } }]);
  assert.deepEqual(calls.addBots, [{ chatId: 'oc_work', appIds: ['cli_bot'] }]);
  assert.equal(calls.send.length, 1);
  const text = calls.send[0].text;
  assert.equal(calls.send[0].chatId, 'oc_work');
  assert.ok(text.includes('<at user_id="ou_bot">小助手</at>'));
  assert.ok(text.includes('muxboard show recC'));
  assert.ok(text.includes('muxboard start recC'));
});

test('assign: bot 不在群成员里时抛 bot_unresolved', async () => {
  const parent = task({ task_id: 'recP', work_chat: { chat_id: 'oc_work', name: null } });
  const child = task({ task_id: 'recC', parent_id: 'recP' });
  const { board, updates } = fakeBoard({ recP: parent, recC: child });
  const { chat, calls } = fakeChat({ members: { users: [], bots: [] } });

  await assert.rejects(
    assign({ positionals: ['recC'], flags: { bot: 'cli_bot' } }, makeCtx({ board, chat })),
    { code: 'bot_unresolved' },
  );
  assert.equal(calls.send.length, 0);
  assert.equal(updates.length, 0, '找不到 bot 时不应写负责人');
});

test('assign: 子任务没有父任务时抛 no_work_chat', async () => {
  const root = task({ task_id: 'recR', parent_id: null });
  const { board, updates } = fakeBoard({ recR: root });
  const { chat } = fakeChat();

  await assert.rejects(
    assign({ positionals: ['recR'], flags: { bot: 'cli_bot' } }, makeCtx({ board, chat })),
    { code: 'no_work_chat' },
  );
  assert.equal(updates.length, 0);
});

// ---------- status ----------

test('status: 子任务完成时 @ 父任务负责人 bot，并写入进展', async () => {
  const parent = task({
    task_id: 'recP',
    owner: 'cli_pbot',
    work_chat: { chat_id: 'oc_work', name: null },
  });
  const child = task({ task_id: 'recC', title: '子', parent_id: 'recP' });
  const { board, updates } = fakeBoard({ recP: parent, recC: child }, { children: [] });
  const { chat, calls } = fakeChat({
    members: { users: [], bots: [{ app_id: 'cli_pbot', open_id: 'ou_pbot', name: '父bot' }] },
  });

  const data = await status(
    { positionals: ['recC', Status.DONE], flags: { note: '做完了' } },
    makeCtx({ board, chat }),
  );

  assert.deepEqual(data, { task_id: 'recC', status: Status.DONE, notified: true });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'recC');
  assert.equal(updates[0].patch.status, Status.DONE);
  assert.equal(updates[0].patch.progress, '[10-17 15:30] 已完成：做完了');
  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].chatId, 'oc_work');
  assert.ok(calls.send[0].text.startsWith('<at user_id="ou_pbot">父bot</at> 任务「子」（recC）已完成：做完了'));
  assert.ok(calls.send[0].text.includes('muxboard children recP'));
});

test('status: 子任务有未完成子任务时抛 children_unfinished，且不调用 updateTask', async () => {
  const child = task({ task_id: 'recC', parent_id: 'recP' });
  const { board, updates } = fakeBoard(
    { recC: child },
    { children: [task({ task_id: 'recD', status: Status.IN_PROGRESS })] },
  );
  const { chat, calls } = fakeChat();

  await assert.rejects(
    status({ positionals: ['recC', Status.DONE], flags: { note: 'x' } }, makeCtx({ board, chat })),
    { code: 'children_unfinished' },
  );
  assert.equal(updates.length, 0);
  assert.equal(calls.send.length, 0);
});

test('status: 根任务完成时在根群里 @ 派发人', async () => {
  const root = task({
    task_id: 'recR',
    title: '根任务',
    dispatcher: { open_id: 'ou_disp', name: '张三' },
    work_chat: { chat_id: 'oc_root', name: null },
  });
  const { board, updates } = fakeBoard({ recR: root }, { children: [] });
  const { chat, calls } = fakeChat();

  const data = await status(
    { positionals: ['recR', Status.DONE], flags: { note: '全部完成' } },
    makeCtx({ board, chat }),
  );

  assert.deepEqual(data, { task_id: 'recR', status: Status.DONE, notified: true });
  assert.equal(updates[0].patch.status, Status.DONE);
  assert.equal(calls.send[0].chatId, 'oc_root');
  assert.ok(calls.send[0].text.startsWith('<at user_id="ou_disp">张三</at> 任务「根任务」（recR）已完成：全部完成'));
});

test('status: 根任务没有派发人时只发消息，不 @ 人', async () => {
  const root = task({ task_id: 'recR', title: '根任务', work_chat: { chat_id: 'oc_root', name: null } });
  const { board } = fakeBoard({ recR: root }, { children: [] });
  const { chat, calls } = fakeChat();

  await status({ positionals: ['recR', Status.BLOCKED], flags: { note: '卡住了' } }, makeCtx({ board, chat }));

  assert.ok(calls.send[0].text.startsWith('任务「根任务」（recR）受阻：卡住了'));
});

test('status: 根任务没有工作群（旧数据）时 notified=false，不发消息', async () => {
  const root = task({ task_id: 'recR', title: '根任务', work_chat: null });
  const { board, updates } = fakeBoard({ recR: root }, { children: [] });
  const { chat, calls } = fakeChat();

  const data = await status(
    { positionals: ['recR', Status.BLOCKED], flags: { note: '卡住了' } },
    makeCtx({ board, chat }),
  );

  assert.deepEqual(data, { task_id: 'recR', status: Status.BLOCKED, notified: false });
  assert.equal(updates.length, 1);
  assert.equal(calls.send.length, 0);
});

test('status: 阻塞时缺 --note 抛 note_required', async () => {
  const { board, updates } = fakeBoard({});
  const { chat } = fakeChat();

  await assert.rejects(
    status({ positionals: ['recC', Status.BLOCKED], flags: {} }, makeCtx({ board, chat })),
    { code: 'note_required' },
  );
  assert.equal(updates.length, 0);
});

test('status: 进行中时 note 可选，缺省为「继续处理」且不通知', async () => {
  const child = task({ task_id: 'recC', parent_id: 'recP' });
  const { board, updates } = fakeBoard({ recC: child });
  const { chat, calls } = fakeChat();

  const data = await status({ positionals: ['recC', Status.IN_PROGRESS], flags: {} }, makeCtx({ board, chat }));

  assert.deepEqual(data, { task_id: 'recC', status: Status.IN_PROGRESS, notified: false });
  assert.equal(updates[0].patch.progress, '[10-17 15:30] 进行中：继续处理');
  assert.equal(calls.send.length, 0);
});

test('status: 非法状态抛 invalid_status', async () => {
  const { board } = fakeBoard({});
  const { chat } = fakeChat();

  await assert.rejects(
    status({ positionals: ['recC', '待分配'], flags: {} }, makeCtx({ board, chat })),
    { code: 'invalid_status' },
  );
});

test('status: 通知目标解析失败（bot_unresolved）时不调用 updateTask', async () => {
  const parent = task({ task_id: 'recP', owner: 'cli_pbot', work_chat: { chat_id: 'oc_work', name: null } });
  const child = task({ task_id: 'recC', parent_id: 'recP' });
  const { board, updates } = fakeBoard({ recP: parent, recC: child }, { children: [] });
  const { chat, calls } = fakeChat({ members: { users: [], bots: [] } });

  await assert.rejects(
    status({ positionals: ['recC', Status.BLOCKED], flags: { note: '卡住' } }, makeCtx({ board, chat })),
    { code: 'bot_unresolved' },
  );
  assert.equal(updates.length, 0);
  assert.equal(calls.send.length, 0);
});

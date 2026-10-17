// add / assign / status 三个命令的流程测试。board 和 chat 都是假对象，不调用 lark-cli。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, task } from './helpers.js';
import { run as add } from '../lib/commands/add.js';
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
function fakeChat({ members = { users: [], bots: [] }, description = '' } = {}) {
  const calls = { create: [], send: [], addBots: [] };
  return {
    calls,
    chat: {
      async create(opts) {
        calls.create.push(opts);
        return 'oc_new';
      },
      async getDescription() {
        return description;
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

test('add: 父任务已有工作群时不建群，直接建子任务', async () => {
  const parent = task({ task_id: 'recP', title: '父', work_chat: { chat_id: 'oc_work', name: '群' } });
  const { board, created, updates } = fakeBoard({ recP: parent });
  const { chat, calls } = fakeChat();

  const data = await add(addArgs('recP', { priority: '高' }), makeCtx({ board, chat }));

  assert.deepEqual(data, { task_id: 'recNew', chat_id: 'oc_work', chat_created: false });
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

test('add: 根任务第一次 add 时用 env.chatId 作上级群并建群', async () => {
  const parent = task({ task_id: 'recP', title: '根任务' });
  const { board, created, updates } = fakeBoard({ recP: parent });
  const { chat, calls } = fakeChat({
    members: { users: [{ open_id: 'ou_a' }, { open_id: 'ou_b' }], bots: [] },
  });

  const data = await add(addArgs('recP'), makeCtx({ board, chat, env: { chatId: 'oc_upper' } }));

  assert.deepEqual(data, { task_id: 'recNew', chat_id: 'oc_new', chat_created: true });
  assert.deepEqual(calls.create, [
    {
      name: '根任务',
      description: formatDescription({ taskId: 'recP', upperChatId: 'oc_upper' }),
      userOpenIds: ['ou_a', 'ou_b'],
    },
  ]);
  assert.deepEqual(updates, [{ id: 'recP', patch: { work_chat_id: 'oc_new' } }]);
  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].chatId, 'oc_new');
  assert.match(calls.send[0].text, /recP/);
  assert.equal(created[0].parent_id, 'recP');
});

test('add: 建群时只拉人，不传 botAppIds，人数最多 50', async () => {
  const users = Array.from({ length: 60 }, (_, i) => ({ open_id: `ou_${i}` }));
  const parent = task({ task_id: 'recP', title: '根任务' });
  const { board } = fakeBoard({ recP: parent });
  const { chat, calls } = fakeChat({ members: { users, bots: [] } });

  await add(addArgs('recP'), makeCtx({ board, chat, env: { chatId: 'oc_upper' } }));

  const opts = calls.create[0];
  assert.equal(opts.userOpenIds.length, 50);
  assert.equal(opts.userOpenIds[0], 'ou_0');
  assert.ok(!('botAppIds' in opts));
});

test('add: 非根父任务第一次 add 时上级群取祖父任务的工作群，群名带两级标题', async () => {
  const grand = task({ task_id: 'recG', title: '总任务', work_chat: { chat_id: 'oc_grand', name: null } });
  const parent = task({ task_id: 'recP', title: '子任务A', parent_id: 'recG' });
  const { board, updates } = fakeBoard({ recG: grand, recP: parent });
  const { chat, calls } = fakeChat();

  const data = await add(addArgs('recP'), makeCtx({ board, chat, env: { chatId: 'oc_current' } }));

  assert.equal(data.chat_created, true);
  assert.equal(calls.create[0].name, '总任务 - 子任务A');
  assert.equal(
    calls.create[0].description,
    formatDescription({ taskId: 'recP', upperChatId: 'oc_grand' }),
  );
  assert.deepEqual(updates, [{ id: 'recP', patch: { work_chat_id: 'oc_new' } }]);
  assert.match(calls.send[0].text, /oc_grand/);
});

test('add: 非根父任务的祖父没有工作群时抛 no_work_chat，不建群', async () => {
  const grand = task({ task_id: 'recG', title: '总任务' });
  const parent = task({ task_id: 'recP', title: '子任务A', parent_id: 'recG' });
  const { board, created } = fakeBoard({ recG: grand, recP: parent });
  const { chat, calls } = fakeChat();

  await assert.rejects(
    add(addArgs('recP'), makeCtx({ board, chat, env: { chatId: 'oc_current' } })),
    { code: 'no_work_chat' },
  );
  assert.equal(calls.create.length, 0);
  assert.equal(created.length, 0);
});

test('add: 根任务第一次 add 且没有 BOTMUX_CHAT_ID 时抛 not_in_botmux', async () => {
  const parent = task({ task_id: 'recP', title: '根任务' });
  const { board } = fakeBoard({ recP: parent });
  const { chat } = fakeChat();

  await assert.rejects(
    add(addArgs('recP'), makeCtx({ board, chat, env: { chatId: undefined } })),
    { code: 'not_in_botmux' },
  );
});

test('add: 优先级不合法时抛 invalid_args', async () => {
  const { board } = fakeBoard({});
  await assert.rejects(
    add(addArgs('recP', { priority: '紧急' }), makeCtx({ board })),
    { code: 'invalid_args' },
  );
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

test('status: 根任务完成时发到工作群描述里的上级群，并 @ 派发人', async () => {
  const root = task({
    task_id: 'recR',
    title: '根任务',
    dispatcher: { open_id: 'ou_disp', name: '张三' },
    work_chat: { chat_id: 'oc_work', name: null },
  });
  const { board, updates } = fakeBoard({ recR: root }, { children: [] });
  const { chat, calls } = fakeChat({
    description: formatDescription({ taskId: 'recR', upperChatId: 'oc_upper' }),
  });

  const data = await status(
    { positionals: ['recR', Status.DONE], flags: { note: '全部完成' } },
    makeCtx({ board, chat }),
  );

  assert.deepEqual(data, { task_id: 'recR', status: Status.DONE, notified: true });
  assert.equal(updates[0].patch.status, Status.DONE);
  assert.equal(calls.send[0].chatId, 'oc_upper');
  assert.ok(calls.send[0].text.startsWith('<at user_id="ou_disp">张三</at> 任务「根任务」（recR）已完成：全部完成'));
});

test('status: 根任务没有工作群时 notified=false，不发消息', async () => {
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

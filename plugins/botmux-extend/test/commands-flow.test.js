// add / split / assign / status 四个命令的流程测试。board 和 chat 都是假对象，不调用 lark-cli。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, task } from './helpers.js';
import { run as add } from '../lib/commands/add.js';
import { run as split } from '../lib/commands/split.js';
import { run as assign } from '../lib/commands/assign.js';
import { run as unassign } from '../lib/commands/unassign.js';
import { run as status } from '../lib/commands/status.js';
import { Status } from '../lib/constants.js';
import { formatDescription } from '../lib/workchat.js';

/** 按 taskId 查的假 board，记录 updateTask / createTask 调用。 */
function fakeBoard(tasks, { children = [], owned = [], childrenOf = {} } = {}) {
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
      async listChildren(id) {
        return childrenOf[id] ?? children;
      },
      async listByOwner(appId, opts) {
        return owned.filter((t) => t.owner === appId && (!opts?.statuses || opts.statuses.includes(t.status)));
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
  // 子任务还没有执行方，不写创建方的主机
  assert.equal('hostname' in created[0], false);
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

test('add: --deps 写入依赖（去重），依赖须是同一父任务的子任务', async () => {
  const parent = task({ task_id: 'recP', work_chat: { chat_id: 'oc_work', name: '群' } });
  const depA = task({ task_id: 'recA', parent_id: 'recP' });
  const depB = task({ task_id: 'recB', parent_id: 'recP' });
  const { board, created } = fakeBoard({ recP: parent, recA: depA, recB: depB });

  await add(addArgs('recP', { deps: 'recA, recB,recA' }), makeCtx({ board }));
  assert.deepEqual(created[0].deps, ['recA', 'recB']);
});

test('add: 没有 --deps 时不写 deps', async () => {
  const parent = task({ task_id: 'recP', work_chat: { chat_id: 'oc_work', name: '群' } });
  const { board, created } = fakeBoard({ recP: parent });
  await add(addArgs('recP'), makeCtx({ board }));
  assert.equal('deps' in created[0], false);
});

test('add: 依赖不属于同一父任务时抛 invalid_args，依赖不存在时抛 not_found，都不建任务', async () => {
  const parent = task({ task_id: 'recP', work_chat: { chat_id: 'oc_work', name: '群' } });
  const other = task({ task_id: 'recX', parent_id: 'recQ' });
  const { board, created } = fakeBoard({ recP: parent, recX: other });

  await assert.rejects(add(addArgs('recP', { deps: 'recX' }), makeCtx({ board })), { code: 'invalid_args' });
  await assert.rejects(add(addArgs('recP', { deps: 'recNone' }), makeCtx({ board })), { code: 'not_found' });
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
  assert.deepEqual(updates, [{ id: 'recC', patch: { work_chat_id: 'oc_new', hostname: 'host-a' } }]);
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
  const child = task({ task_id: 'recC', title: '子', parent_id: 'recP', status: Status.PENDING, owner: null });
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
  const child = task({ task_id: 'recC', parent_id: 'recP', status: Status.PENDING, owner: null });
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

/** assign 调度检查用例：父任务有工作群，子任务待分配、没有负责人。 */
function assignSetup(childOverrides = {}, extraTasks = {}, opts = {}) {
  const parent = task({ task_id: 'recP', work_chat: { chat_id: 'oc_work', name: null } });
  const child = task({ task_id: 'recC', parent_id: 'recP', status: Status.PENDING, owner: null, ...childOverrides });
  const fb = fakeBoard({ recP: parent, recC: child, ...extraTasks }, opts);
  const fc = fakeChat({ members: { users: [], bots: [{ app_id: 'cli_bot', open_id: 'ou_bot', name: 'b' }] } });
  const run = () => assign({ positionals: ['recC'], flags: { bot: 'cli_bot' } }, makeCtx({ board: fb.board, chat: fc.chat }));
  return { ...fb, calls: fc.calls, run };
}

test('assign: 子任务已有负责人或不是待分配时抛 already_assigned，不拉人不写', async () => {
  for (const overrides of [{ owner: 'cli_other' }, { status: Status.IN_PROGRESS }, { status: Status.DONE }]) {
    const { updates, calls, run } = assignSetup(overrides);
    await assert.rejects(run(), { code: 'already_assigned' });
    assert.equal(calls.addBots.length, 0);
    assert.equal(updates.length, 0);
  }
});

test('assign: 依赖未全部完成时抛 deps_unfinished，并列出未完成的依赖', async () => {
  const { updates, calls, run } = assignSetup(
    { deps: ['recA', 'recB'] },
    { recA: task({ task_id: 'recA', status: Status.DONE }), recB: task({ task_id: 'recB', status: Status.IN_PROGRESS }) },
  );
  await assert.rejects(run(), (err) => err.code === 'deps_unfinished' && err.message.includes('recB（进行中）') && !err.message.includes('recA'));
  assert.equal(calls.addBots.length, 0);
  assert.equal(updates.length, 0);
});

test('assign: 依赖全部完成时正常分派', async () => {
  const { updates, run } = assignSetup({ deps: ['recA'] }, { recA: task({ task_id: 'recA', status: Status.DONE }) });
  await run();
  assert.deepEqual(updates, [{ id: 'recC', patch: { owner: 'cli_bot' } }]);
});

test('assign: 目标 bot 有待分配/进行中/阻塞的任务时抛 bot_busy', async () => {
  for (const st of [Status.PENDING, Status.IN_PROGRESS, Status.BLOCKED]) {
    const busy = task({ task_id: 'recW', title: '在做', owner: 'cli_bot', status: st });
    const { updates, calls, run } = assignSetup({}, {}, { owned: [busy], childrenOf: { recW: [] } });
    await assert.rejects(run(), (err) => err.code === 'bot_busy' && err.message.includes(`recW「在做」（${st}）`));
    assert.equal(calls.addBots.length, 0);
    assert.equal(updates.length, 0);
  }
});

test('assign: 目标 bot 只有已完成的任务，或负责的任务有子任务（在协调）时不算占用', async () => {
  const done = task({ task_id: 'recD', owner: 'cli_bot', status: Status.DONE });
  const coordinating = task({ task_id: 'recK', owner: 'cli_bot', status: Status.IN_PROGRESS });
  const { updates, run } = assignSetup({}, {}, {
    owned: [done, coordinating],
    childrenOf: { recK: [task({ task_id: 'recK1', parent_id: 'recK' })] },
  });
  await run();
  assert.deepEqual(updates, [{ id: 'recC', patch: { owner: 'cli_bot' } }]);
});

// ---------- unassign ----------

/** unassign 用例：父任务由 cli_self 负责、有工作群；子任务由 cli_bot 负责、进行中。 */
function unassignSetup(childOverrides = {}, parentOverrides = {}, bots = [{ app_id: 'cli_bot', open_id: 'ou_bot', name: 'b' }]) {
  const parent = task({ task_id: 'recP', owner: 'cli_self', work_chat: { chat_id: 'oc_work', name: null }, ...parentOverrides });
  const child = task({ task_id: 'recC', title: '子', parent_id: 'recP', status: Status.IN_PROGRESS, owner: 'cli_bot', ...childOverrides });
  const fb = fakeBoard({ recP: parent, recC: child });
  const fc = fakeChat({ members: { users: [], bots } });
  const run = (flags = {}) => unassign({ positionals: ['recC'], flags }, makeCtx({ board: fb.board, chat: fc.chat }));
  return { ...fb, calls: fc.calls, run };
}

test('unassign: 清空负责人、状态改回待分配，并在工作群 @ 原负责 bot', async () => {
  const { updates, calls, run } = unassignSetup();
  const data = await run({ note: '无响应' });

  assert.deepEqual(data, { task_id: 'recC', previous_owner: 'cli_bot', status: Status.PENDING, message_id: 'om_1' });
  assert.deepEqual(updates, [{
    id: 'recC',
    patch: { owner: null, status: Status.PENDING, progress: '[10-17 15:30] 待分配：已收回：无响应' },
  }]);
  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].chatId, 'oc_work');
  const text = calls.send[0].text;
  assert.ok(text.includes('<at user_id="ou_bot">b</at>'));
  assert.ok(text.includes('已收回，请停止处理'));
  assert.ok(text.includes('原因：无响应'));
});

test('unassign: 原负责 bot 不在群里时照样收回，消息不 @', async () => {
  const { updates, calls, run } = unassignSetup({}, {}, []);
  await run();
  assert.equal(updates.length, 1);
  assert.ok(!calls.send[0].text.includes('<at'));
  assert.ok(calls.send[0].text.startsWith('cli_bot 任务'));
});

test('unassign: 调用方不是父任务负责人时抛 not_dispatcher，不写不发', async () => {
  const { updates, calls, run } = unassignSetup({}, { owner: 'cli_other' });
  await assert.rejects(run(), { code: 'not_dispatcher' });
  assert.equal(updates.length, 0);
  assert.equal(calls.send.length, 0);
});

test('unassign: 已完成的任务抛 task_done，没有负责人的任务抛 not_assigned', async () => {
  for (const [overrides, code] of [[{ status: Status.DONE }, 'task_done'], [{ status: Status.PENDING, owner: null }, 'not_assigned']]) {
    const { updates, calls, run } = unassignSetup(overrides);
    await assert.rejects(run(), { code });
    assert.equal(updates.length, 0);
    assert.equal(calls.send.length, 0);
  }
});

test('unassign: 待分配和阻塞状态的任务也能收回', async () => {
  for (const st of [Status.PENDING, Status.BLOCKED]) {
    const { updates, run } = unassignSetup({ status: st });
    await run();
    assert.equal(updates[0].patch.owner, null);
  }
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
  assert.equal(updates[0].patch.hostname, 'host-a');
  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].chatId, 'oc_work');
  assert.ok(calls.send[0].text.startsWith('<at user_id="ou_pbot">父bot</at> 任务「子」（recC）已完成：做完了'));
  assert.ok(calls.send[0].text.includes('muxboard children recP'));
  assert.ok(calls.send[0].text.includes('muxboard children recP --ready'));
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from '../lib/chat.js';
import { fakeRunner } from './helpers.js';

test('create 带 users 和 bots 时拼接参数并返回 chat_id', async () => {
  const { run, calls } = fakeRunner([{ chat_id: 'oc_1' }]);
  const chatId = await createChat(run).create({
    name: '任务群',
    description: '说明',
    userOpenIds: ['ou_a', 'ou_b'],
    botAppIds: ['cli_x', 'cli_y'],
  });
  assert.equal(chatId, 'oc_1');
  assert.deepEqual(calls, [[
    'im', '+chat-create',
    '--name', '任务群',
    '--description', '说明',
    '--users', 'ou_a,ou_b',
    '--bots', 'cli_x,cli_y',
  ]]);
});

test('create 不传 users 和 bots 时不带对应参数', async () => {
  const { run, calls } = fakeRunner([{ chat_id: 'oc_2' }]);
  await createChat(run).create({ name: 'n', description: 'd' });
  assert.deepEqual(calls, [['im', '+chat-create', '--name', 'n', '--description', 'd']]);
});

test('create 传空数组时同样不带 --users 和 --bots', async () => {
  const { run, calls } = fakeRunner([{ chat_id: 'oc_3' }]);
  await createChat(run).create({ name: 'n', description: 'd', userOpenIds: [], botAppIds: [] });
  assert.deepEqual(calls[0], ['im', '+chat-create', '--name', 'n', '--description', 'd']);
});

test('getDescription 返回群描述', async () => {
  const { run, calls } = fakeRunner([{ description: '群说明', name: 'n' }]);
  assert.equal(await createChat(run).getDescription('oc_1'), '群说明');
  assert.deepEqual(calls, [['im', 'chats', 'get', '--chat-id', 'oc_1']]);
});

test('getDescription 没有描述时返回空字符串', async () => {
  const { run } = fakeRunner([{ name: 'n' }]);
  assert.equal(await createChat(run).getDescription('oc_1'), '');
});

test('listMembers 映射 users 和 bots 字段', async () => {
  const { run, calls } = fakeRunner([{
    users: [{ member_id: 'ou_x', name: '张三' }],
    bots: [{ app_id: 'cli_x', member_id: 'ou_y', name: '机器人' }],
  }]);
  const members = await createChat(run).listMembers('oc_1');
  assert.deepEqual(members, {
    users: [{ open_id: 'ou_x', name: '张三' }],
    bots: [{ app_id: 'cli_x', open_id: 'ou_y', name: '机器人' }],
  });
  assert.deepEqual(calls, [['im', '+chat-members-list', '--chat-id', 'oc_1', '--page-all']]);
});

test('listMembers 字段缺失时 users/bots 为空数组，name 为 null', async () => {
  const { run } = fakeRunner([
    { users: [{ member_id: 'ou_x' }] },
    {},
  ]);
  const chat = createChat(run);
  assert.deepEqual(await chat.listMembers('oc_1'), {
    users: [{ open_id: 'ou_x', name: null }],
    bots: [],
  });
  assert.deepEqual(await chat.listMembers('oc_1'), { users: [], bots: [] });
});

test('addBots 拼接 id_list 并调用 chat.members create', async () => {
  const { run, calls } = fakeRunner([{}]);
  await createChat(run).addBots('oc_1', ['cli_x', 'cli_y']);
  assert.deepEqual(calls, [[
    'im', 'chat.members', 'create',
    '--chat-id', 'oc_1',
    '--member-id-type', 'app_id',
    '--succeed-type', '1',
    '--data', '{"id_list":["cli_x","cli_y"]}',
  ]]);
});

test('addBots 传空数组时不调用 run', async () => {
  const { run, calls } = fakeRunner();
  await createChat(run).addBots('oc_1', []);
  assert.equal(calls.length, 0);
});

test('send 返回 message_id', async () => {
  const { run, calls } = fakeRunner([{ message_id: 'om_1' }]);
  assert.equal(await createChat(run).send('oc_1', '你好'), 'om_1');
  assert.deepEqual(calls, [['im', '+messages-send', '--chat-id', 'oc_1', '--text', '你好']]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../lib/board.js';
import { fakeRunner } from './helpers.js';

const config = {
  base_token: 'bascn',
  table_id: 'tbl1',
  fields: {
    title: 'fld_title', desc: 'fld_desc', status: 'fld_status', priority: 'fld_priority',
    owner: 'fld_owner', parent: 'fld_parent', work_chat: 'fld_chat', criteria: 'fld_criteria',
    progress: 'fld_progress', output: 'fld_output', updated_at: 'fld_updated', dispatcher: 'fld_disp',
  },
};
const BASE = ['--base-token', 'bascn', '--table-id', 'tbl1'];

// 字段顺序故意与 config 不同，确认按 field_id_list 映射
const FIELD_ID_LIST = [
  'fld_chat', 'fld_status', 'fld_parent', 'fld_title', 'fld_priority', 'fld_disp',
  'fld_owner', 'fld_desc', 'fld_criteria', 'fld_progress', 'fld_output', 'fld_updated',
];

test('getTask 把所有字段类型映射成 Task', async () => {
  const { run, calls } = fakeRunner([{
    data: [[
      [{ id: 'oc_1', name: '群名' }], ['进行中'], [{ id: 'recP' }], '标题', ['高'], [{ id: 'ou_1', name: '张三' }],
      'cli_x', '描述', '验收标准', '进展', '产出', '2026-10-17T16:05:12.000+04:00',
    ]],
    field_id_list: FIELD_ID_LIST,
    record_id_list: ['recT'],
  }]);
  const board = createBoard(run, config);

  const task = await board.getTask('recT');

  assert.deepEqual(calls[0], ['base', '+record-get', ...BASE, '--record-id', 'recT', '--format', 'json']);
  assert.deepEqual(task, {
    task_id: 'recT',
    title: '标题',
    desc: '描述',
    criteria: '验收标准',
    priority: '高',
    status: '进行中',
    owner: 'cli_x',
    progress: '进展',
    output: '产出',
    work_chat: { chat_id: 'oc_1', name: '群名' },
    parent_id: 'recP',
    dispatcher: { open_id: 'ou_1', name: '张三' },
    updated_at: '2026-10-17T16:05:12.000+04:00',
    hostname: null,
    deps: [],
  });
});

test('getTask 空单元格映射为 null', async () => {
  const { run } = fakeRunner([{
    data: [[[], [], [], null, [], [], null, null, null, null, null, null]],
    field_id_list: FIELD_ID_LIST,
    record_id_list: ['recT'],
  }]);
  const task = await createBoard(run, config).getTask('recT');
  assert.equal(task.status, null);
  assert.equal(task.priority, null);
  assert.equal(task.work_chat, null);
  assert.equal(task.parent_id, null);
  assert.equal(task.dispatcher, null);
  assert.equal(task.title, null);
});

test('getTask 记录不存在时抛 not_found', async () => {
  const { run } = fakeRunner([
    { data: [], field_id_list: FIELD_ID_LIST, record_id_list: [], record_not_found: ['recX'] },
    { data: [], field_id_list: FIELD_ID_LIST, record_id_list: [] },
  ]);
  const board = createBoard(run, config);
  await assert.rejects(board.getTask('recX'), { code: 'not_found', message: '任务 recX 不存在' });
  await assert.rejects(board.getTask('recX'), { code: 'not_found' });
});

test('listChildren 只按父任务过滤，并带 --limit 200', async () => {
  const { run, calls } = fakeRunner([{
    data: [
      ['A', null, null, null, null, null, null, null, null, null, null, null],
      ['B', null, null, null, null, null, null, null, null, null, null, null],
    ],
    field_id_list: ['fld_title', 'fld_desc', 'fld_status', 'fld_priority', 'fld_owner', 'fld_parent', 'fld_chat', 'fld_criteria', 'fld_progress', 'fld_output', 'fld_updated', 'fld_disp'],
    record_id_list: ['recA', 'recB'],
  }]);

  const tasks = await createBoard(run, config).listChildren('recP');

  assert.deepEqual(calls[0], [
    'base', '+record-list', ...BASE, '--format', 'json', '--limit', '200',
    '--filter-json', '{"logic":"and","conditions":[["fld_parent","intersects",[{"id":"recP"}]]]}',
  ]);
  assert.deepEqual(tasks.map((t) => [t.task_id, t.title]), [['recA', 'A'], ['recB', 'B']]);
});

test('listChildren 传 status 时增加状态过滤条件', async () => {
  const { run, calls } = fakeRunner([{ data: [], field_id_list: [], record_id_list: [] }]);

  const tasks = await createBoard(run, config).listChildren('recP', { status: '进行中' });

  assert.deepEqual(calls[0], [
    'base', '+record-list', ...BASE, '--format', 'json', '--limit', '200',
    '--filter-json',
    '{"logic":"and","conditions":[["fld_parent","intersects",[{"id":"recP"}]],["fld_status","intersects",["进行中"]]]}',
  ]);
  assert.deepEqual(tasks, []);
});

test('createTask 不带 --record-id，返回新记录 ID', async () => {
  const { run, calls } = fakeRunner([{ created: true, record: { record_id_list: ['recNew'] } }]);

  const id = await createBoard(run, config).createTask({
    title: '新任务', status: '待分配', work_chat_id: 'oc_1', parent_id: null,
  });

  assert.equal(id, 'recNew');
  assert.deepEqual(calls[0], [
    'base', '+record-upsert', ...BASE,
    '--json', '{"fld_title":"新任务","fld_status":["待分配"],"fld_chat":[{"id":"oc_1"}],"fld_parent":null}',
  ]);
});

test('updateTask 转换 patch：select 和引用写成数组，null 清空，只写出现的键', async () => {
  const { run, calls } = fakeRunner([{ updated: true }]);

  await createBoard(run, config).updateTask('recT', {
    priority: '高', dispatcher_open_id: 'ou_2', progress: null, output: '完成',
  });

  assert.deepEqual(calls[0], [
    'base', '+record-upsert', ...BASE, '--record-id', 'recT',
    '--json', '{"fld_priority":["高"],"fld_disp":[{"id":"ou_2"}],"fld_progress":null,"fld_output":"完成"}',
  ]);
});

test('hostname：配置里有该字段时按文本读写', async () => {
  const withHost = { ...config, fields: { ...config.fields, hostname: 'fld_host' } };
  const { run, calls } = fakeRunner([
    { data: [['host-b']], field_id_list: ['fld_host'], record_id_list: ['recT'] },
    { updated: true },
  ]);
  const board = createBoard(run, withHost);

  assert.equal((await board.getTask('recT')).hostname, 'host-b');
  await board.updateTask('recT', { status: '进行中', hostname: 'host-a' });
  assert.deepEqual(calls[1].slice(-2), ['--json', '{"fld_status":["进行中"],"fld_host":"host-a"}']);
});

test('deps：读为任务 ID 数组，写入为引用数组', async () => {
  const withDeps = { ...config, fields: { ...config.fields, deps: 'fld_deps' } };
  const { run, calls } = fakeRunner([
    { data: [[[{ id: 'recA' }, { id: 'recB' }]], [[]]], field_id_list: ['fld_deps'], record_id_list: ['recT', 'recU'] },
    { created: true, record: { record_id_list: ['recNew'] } },
  ]);
  const board = createBoard(run, withDeps);

  const [t, u] = await board.listChildren('recP');
  assert.deepEqual(t.deps, ['recA', 'recB']);
  assert.deepEqual(u.deps, []);
  await board.createTask({ title: 'x', deps: ['recA'] });
  assert.deepEqual(calls[1].slice(-2), ['--json', '{"fld_title":"x","fld_deps":[{"id":"recA"}]}']);
});

test('listByOwner 按负责人精确过滤，可加状态条件', async () => {
  const { run, calls } = fakeRunner([
    { data: [['A']], field_id_list: ['fld_title'], record_id_list: ['recA'] },
    { data: [], field_id_list: [], record_id_list: [] },
  ]);
  const board = createBoard(run, config);

  const tasks = await board.listByOwner('cli_x', { statuses: ['待分配', '进行中', '阻塞'] });
  assert.deepEqual(calls[0], [
    'base', '+record-list', ...BASE, '--format', 'json', '--limit', '200',
    '--filter-json',
    '{"logic":"and","conditions":[["fld_owner","==","cli_x"],["fld_status","intersects",["待分配","进行中","阻塞"]]]}',
  ]);
  assert.deepEqual(tasks.map((t) => t.task_id), ['recA']);

  await board.listByOwner('cli_y');
  assert.equal(calls[1].at(-1), '{"logic":"and","conditions":[["fld_owner","==","cli_y"]]}');
});

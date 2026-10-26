import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { boardConfigPath, readBoardConfig, writeBoardConfig, loadBoardTemplate, checkBoardConfig } from '../lib/config.js';
import { provisionBoard } from '../lib/provision.js';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeRunner } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'muxboard-'));

test('boardConfigPath 默认在 ~/.config/muxboard，MUXBOARD_CONFIG 可覆盖', () => {
  assert.equal(boardConfigPath({}), join(homedir(), '.config', 'muxboard', 'board.json'));
  assert.equal(boardConfigPath({ MUXBOARD_CONFIG: '/x/b.json' }), '/x/b.json');
});

test('readBoardConfig 文件不存在返回 null；writeBoardConfig 自动建目录', () => {
  const path = join(tmp(), 'a', 'b', 'board.json');
  assert.equal(readBoardConfig(path), null);
  writeBoardConfig(path, { base_token: 'bas1', table_id: 'tbl1', fields: {}, url: 'u' });
  assert.deepEqual(readBoardConfig(path), { base_token: 'bas1', table_id: 'tbl1', fields: {}, url: 'u' });
});

test('插件自带的模板只有表结构，不含任何 ID', () => {
  const template = loadBoardTemplate();
  assert.equal('base_token' in template, false);
  assert.equal('table_id' in template, false);
  assert.deepEqual(Object.keys(template.fields).sort(), [
    'criteria', 'deps', 'desc', 'dispatcher', 'hostname', 'output', 'owner', 'parent',
    'priority', 'progress', 'status', 'title', 'updated_at', 'work_chat',
  ]);
  // 第一个字段是主字段
  assert.equal(Object.keys(template.fields)[0], 'title');
});

const TEMPLATE = {
  base_name: '任务看板',
  table_name: '任务',
  fields: {
    title: { name: '任务标题', type: 'text' },
    parent: { name: '父任务', type: 'link', bidirectional: true, bidirectional_link_field_name: '子任务' },
  },
};

test('provisionBoard 建 base、补建关联字段、读回字段 ID 和链接，并给 owner 授权', async () => {
  const { run, calls } = fakeRunner([
    { base: { base_token: 'basNew' } },
    { tables: [{ id: 'tblNew', name: '任务' }] },
    { created: 1 },
    { fields: [{ id: 'fldT', name: '任务标题' }, { id: 'fldP', name: '父任务' }, { id: 'fldC', name: '子任务' }] },
    { base: { url: 'https://x.feishu.cn/base/basNew' } },
    {},
  ]);

  const config = await provisionBoard(run, TEMPLATE, { ownerOpenId: 'ou_owner' });

  assert.deepEqual(config, {
    base_token: 'basNew',
    table_id: 'tblNew',
    fields: { title: 'fldT', parent: 'fldP' },
    url: 'https://x.feishu.cn/base/basNew',
  });
  assert.deepEqual(calls[0], [
    'base', '+base-create', '--name', '任务看板', '--table-name', '任务',
    '--fields', JSON.stringify([{ name: '任务标题', type: 'text' }]),
  ]);
  assert.deepEqual(calls[2], [
    'base', '+field-create', '--base-token', 'basNew', '--table-id', 'tblNew', '--json',
    JSON.stringify([{ ...TEMPLATE.fields.parent, link_table: 'tblNew' }]),
  ]);
  assert.deepEqual(calls[5], [
    'drive', '+member-add', '--token', 'basNew', '--type', 'bitable',
    '--member-type', 'openid', '--member-id', 'ou_owner', '--perm', 'full_access', '--yes',
  ]);
});

test('provisionBoard 没有 owner 时不授权', async () => {
  const { run, calls } = fakeRunner([
    { base: { base_token: 'basNew' } },
    { tables: [{ id: 'tblNew', name: '任务' }] },
    {},
    { fields: [{ id: 'fldT', name: '任务标题' }, { id: 'fldP', name: '父任务' }] },
    { base: { url: 'u' } },
  ]);
  await provisionBoard(run, TEMPLATE, {});
  assert.equal(calls.length, 5);
});

test('provisionBoard 读不到字段时抛 lark_error', async () => {
  const { run } = fakeRunner([
    { base: { base_token: 'basNew' } },
    { tables: [{ id: 'tblNew', name: '任务' }] },
    {},
    { fields: [{ id: 'fldT', name: '任务标题' }] },
  ]);
  await assert.rejects(provisionBoard(run, TEMPLATE, {}), (err) => err.code === 'lark_error' && err.message.includes('父任务'));
});

const MUXBOARD = fileURLToPath(new URL('../bin/muxboard', import.meta.url));

/** 以子进程运行 muxboard，返回退出码和解析后的输出。 */
function runCli(argv, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [MUXBOARD, ...argv], { env: { PATH: process.env.PATH, ...env } }, (err, stdout) => {
      resolve({ code: err?.code ?? 0, out: JSON.parse(stdout) });
    });
  });
}

test('cli 看板配置缺失时，init 以外的命令报 board_not_initialized', async () => {
  const path = join(tmp(), 'board.json');
  const { code, out } = await runCli(['show', 'recA'], { BOTMUX_LARK_APP_ID: 'cli_self', MUXBOARD_CONFIG: path });
  assert.equal(code, 1);
  assert.equal(out.error.code, 'board_not_initialized');
  assert.match(out.error.message, /muxboard init/);
});

/** 模板里每个字段都配上一个假的字段 ID。 */
function fullFields() {
  return Object.fromEntries(Object.keys(loadBoardTemplate().fields).map((key) => [key, `fld_${key}`]));
}

test('checkBoardConfig 配置齐全时通过，缺字段时报 board_config_incomplete 并给出补法', () => {
  const template = loadBoardTemplate();
  assert.doesNotThrow(() => checkBoardConfig({ fields: fullFields() }, template, '/x/board.json'));

  const { hostname, deps, ...rest } = fullFields();
  assert.throws(() => checkBoardConfig({ fields: rest }, template, '/x/board.json'), (err) => {
    assert.equal(err.code, 'board_config_incomplete');
    assert.match(err.message, /hostname（「主机」，类型 text）/);
    assert.match(err.message, /deps（「依赖」，类型 link）/);
    assert.match(err.message, /\/x\/board\.json 的 fields\.<逻辑名>/);
    return true;
  });
});

test('cli 看板配置缺字段时报 board_config_incomplete，不调用 lark-cli', async () => {
  const path = join(tmp(), 'board.json');
  const { deps, ...fields } = fullFields();
  writeBoardConfig(path, { base_token: 'basCfg', table_id: 'tblCfg', fields, url: 'u' });
  const { code, out } = await runCli(['show', 'recA'], {
    BOTMUX_LARK_APP_ID: 'cli_self', MUXBOARD_CONFIG: path, MUXBOARD_LARK_BIN: '/nonexistent/lark-cli',
  });
  assert.equal(code, 1);
  assert.equal(out.error.code, 'board_config_incomplete');
  assert.match(out.error.message, /deps（「依赖」/);
});

test('cli 看板配置存在时直接使用其中的 base 和数据表', async () => {
  const dir = tmp();
  const path = join(dir, 'board.json');
  writeBoardConfig(path, { base_token: 'basCfg', table_id: 'tblCfg', fields: { ...fullFields(), title: 'fldT' }, url: 'u' });
  // 假的 lark-cli：记录参数，返回一条只有标题的记录
  const bin = join(dir, 'lark-cli');
  const log = join(dir, 'args.json');
  writeFileSync(bin, `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ ok: true, data: { data: [['标题']], field_id_list: ['fldT'], record_id_list: ['recA'] } }));
`);
  chmodSync(bin, 0o755);
  const { code, out } = await runCli(['show', 'recA'], {
    BOTMUX_LARK_APP_ID: 'cli_self', MUXBOARD_CONFIG: path, MUXBOARD_LARK_BIN: bin,
  });
  assert.equal(code, 0, JSON.stringify(out));
  assert.equal(out.data.title, '标题');
  const args = JSON.parse(readFileSync(log, 'utf8'));
  assert.deepEqual(args.slice(2, 6), ['--base-token', 'basCfg', '--table-id', 'tblCfg']);
});

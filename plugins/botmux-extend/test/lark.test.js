import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLarkRunner, defaultProfile } from '../lib/lark.js';

// 假的 lark-cli：记录参数，把给定的 JSON 写到 stdout（出错时同真实 lark-cli，写到 stderr 并以 3 退出）
function fakeBin(output, { stderr = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'muxboard-lark-'));
  const bin = join(dir, 'lark-cli');
  const log = join(dir, 'args.json');
  writeFileSync(bin, `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
process.${stderr ? 'stderr' : 'stdout'}.write(${JSON.stringify(JSON.stringify(output))});
${stderr ? 'process.exitCode = 3;' : ''}
`);
  chmodSync(bin, 0o755);
  return { bin, args: () => JSON.parse(readFileSync(log, 'utf8')) };
}

test('runner 以当前 bot 的 profile 调用 lark-cli', async () => {
  const { bin, args } = fakeBin({ ok: true, data: { x: 1 } });
  const data = await createLarkRunner(bin, 'cli_self')(['base', '+base-get']);
  assert.deepEqual(data, { x: 1 });
  assert.deepEqual(args(), ['base', '+base-get', '--as', 'bot', '--profile', 'cli_self']);
});

test('runner 没有 profile 时只加 --as bot', async () => {
  const { bin, args } = fakeBin({ ok: true, data: {} });
  await createLarkRunner(bin, '')(['base', '+base-get']);
  assert.deepEqual(args(), ['base', '+base-get', '--as', 'bot']);
});

test('runner 在 profile 不存在时报错并提示添加方式', async () => {
  const { bin } = fakeBin({
    ok: false,
    error: { type: 'config', subtype: 'not_configured', message: 'profile "cli_x" not found', field: '--profile' },
  }, { stderr: true });
  await assert.rejects(createLarkRunner(bin, 'cli_x')(['base', '+base-get']), (e) => {
    assert.equal(e.code, 'lark_error');
    assert.match(e.message, /lark-cli profile add --name cli_x --app-id cli_x --app-secret-stdin/);
    return true;
  });
});

test('defaultProfile：经过 botmux 托管入口时不加 profile，否则用 BOTMUX_LARK_APP_ID', () => {
  assert.equal(defaultProfile({ BOTMUX_LARK_APP_ID: 'cli_self', BOTMUX_LARK_TOOL_BINDING: '/b.json' }), undefined);
  assert.equal(
    defaultProfile({ BOTMUX_LARK_APP_ID: 'cli_self', BOTMUX_LARK_TOOL_BINDING: '/b.json', MUXBOARD_LARK_BIN: '/x' }),
    'cli_self',
  );
  assert.equal(defaultProfile({ BOTMUX_LARK_APP_ID: 'cli_self' }), 'cli_self');
  assert.equal(defaultProfile({}), undefined);
});

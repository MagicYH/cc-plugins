import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../lib/args.js';
import { formatProgress } from '../lib/progress.js';
import { formatDescription, chatName } from '../lib/workchat.js';
import { fixedNow } from './helpers.js';

test('parseArgs 拆分命令、位置参数和 flag', () => {
  assert.deepEqual(parseArgs(['status', 'recA', '已完成', '--note', '好了', '--x=1']), {
    command: 'status',
    positionals: ['recA', '已完成'],
    flags: { note: '好了', x: '1' },
  });
});

test('parseArgs 遇到缺值的 flag 抛 invalid_args', () => {
  assert.throws(() => parseArgs(['init', '--title']), { code: 'invalid_args' });
});

test('formatProgress 生成 [MM-DD HH:mm] 状态：说明', () => {
  assert.equal(formatProgress('阻塞', '缺数据库地址', fixedNow()), '[10-17 15:30] 阻塞：缺数据库地址');
});

test('群描述记下任务 ID 和上级群，且不超过 100 个字符', () => {
  const desc = formatDescription({ taskId: 'reczz28ONSu9L56v', upperChatId: 'oc_0123456789abcdef0123456789abcdef' });
  assert.equal(desc, 'muxboard task=reczz28ONSu9L56v upper=oc_0123456789abcdef0123456789abcdef');
  assert.ok(desc.length <= 100);
});

test('chatName 由根任务标题和该任务标题组成', () => {
  assert.equal(chatName('电商系统', '用户系统'), '电商系统 - 用户系统');
});

#!/usr/bin/env node
// Stop hook：在 botmux 会话中提醒用 botmux send 回复用户，并在执行看板任务时用 muxboard 更新状态。
// stop_hook_active 为 true 说明本轮已被 Stop hook 拦过一次，直接放行，避免反复注入。

if (!process.env.BOTMUX_LARK_APP_ID) process.exit(0);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { /* 输入异常时按未触发处理 */ }
  if (input.stop_hook_active) process.exit(0);

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '当前在 botmux 会话中，用户看不到终端输出。如需回复用户，请用 `botmux send` 发送消息（如 `botmux send "内容"`，长内容用 --content-file）；已回复或无需回复则直接结束。若本轮在执行 task-board 任务（muxboard 任务 ID，rec 开头），记得用 muxboard 更新状态，如 `muxboard status <任务ID> 已完成`（阻塞用 `muxboard status <任务ID> 阻塞 --note <说明>`），有产出用 `muxboard output <任务ID> <内容>`。',
  }));
});

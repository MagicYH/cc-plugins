// muxboard start —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard start」。

import { requirePositional } from '../args.js';
import { Status } from '../constants.js';
import { formatProgress } from '../progress.js';

/** @type {import('../context.js').CommandRun} */
export async function run({ positionals }, ctx) {
  const id = requirePositional(positionals, 0, '任务ID');
  const t = await ctx.board.getTask(id);

  // 只有待分配的任务才改为进行中；其他状态原样返回
  if (t.status !== Status.PENDING) {
    return { task_id: id, status: t.status };
  }

  await ctx.board.updateTask(id, {
    status: Status.IN_PROGRESS,
    progress: formatProgress(Status.IN_PROGRESS, '开始处理', ctx.now()),
    hostname: ctx.env.hostname,
  });
  return { task_id: id, status: Status.IN_PROGRESS };
}

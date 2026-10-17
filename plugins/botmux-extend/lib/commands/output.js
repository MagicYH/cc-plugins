// muxboard output —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard output」。

import { requirePositional } from '../args.js';

/** @type {import('../context.js').CommandRun} */
export async function run({ positionals }, ctx) {
  const id = requirePositional(positionals, 0, '任务ID');
  const content = requirePositional(positionals, 1, '内容');
  await ctx.board.getTask(id);
  await ctx.board.updateTask(id, { output: content });
  return { task_id: id };
}

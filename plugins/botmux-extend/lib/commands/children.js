// muxboard children —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard children」。

import { requirePositional } from '../args.js';
import { MuxError, ErrorCode } from '../errors.js';
import { Status } from '../constants.js';

/** @type {import('../context.js').CommandRun} */
export async function run({ positionals, flags }, ctx) {
  const id = requirePositional(positionals, 0, '任务ID');
  const status = flags.status;
  if (status !== undefined && !Object.values(Status).includes(status)) {
    throw new MuxError(ErrorCode.INVALID_STATUS, `状态必须是 ${Object.values(Status).join('/')}`);
  }

  // 先确认父任务存在，不存在时 board 会抛 not_found
  await ctx.board.getTask(id);
  const list = status === undefined
    ? await ctx.board.listChildren(id)
    : await ctx.board.listChildren(id, { status });

  return {
    children: list.map((c) => ({
      task_id: c.task_id,
      title: c.title,
      owner: c.owner,
      status: c.status,
      progress: c.progress,
      output: c.output,
      updated_at: c.updated_at,
    })),
  };
}

// muxboard add —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard add」。

import { MuxError, ErrorCode } from '../errors.js';
import { requireFlag, requirePositional } from '../args.js';
import { Status, PRIORITIES, DEFAULT_PRIORITY } from '../constants.js';

/** @type {import('../context.js').CommandRun} */
export async function run(args, ctx) {
  const parentId = requirePositional(args.positionals, 0, '父任务ID');
  const title = requireFlag(args.flags, 'title');
  const desc = requireFlag(args.flags, 'desc');
  const criteria = requireFlag(args.flags, 'criteria');
  const priority = args.flags.priority ?? DEFAULT_PRIORITY;
  if (!PRIORITIES.includes(priority)) {
    throw new MuxError(ErrorCode.INVALID_ARGS, `优先级必须是 ${PRIORITIES.join('/')}，收到：${priority}`);
  }

  const deps = [...new Set((args.flags.deps ?? '').split(',').map((d) => d.trim()).filter(Boolean))];

  // 子任务在父任务的工作群里分派：根任务的群来自 init，其他任务要先 split
  const parent = await ctx.board.getTask(parentId);
  const chatId = parent.work_chat?.chat_id;
  if (!chatId) {
    throw new MuxError(ErrorCode.NO_WORK_CHAT, `任务 ${parentId} 还没有工作群，请先执行 muxboard split ${parentId}`);
  }

  // 依赖只能是同一父任务下的兄弟任务；不存在时 board 抛 not_found
  for (const depId of deps) {
    const dep = await ctx.board.getTask(depId);
    if (dep.parent_id !== parent.task_id) {
      throw new MuxError(ErrorCode.INVALID_ARGS, `依赖 ${depId} 不是 ${parent.task_id} 的子任务，依赖只能指向同一父任务下的任务`);
    }
  }

  const taskId = await ctx.board.createTask({
    title,
    desc,
    criteria,
    priority,
    status: Status.PENDING,
    parent_id: parent.task_id,
    ...(deps.length ? { deps } : {}),
  });
  return { task_id: taskId, chat_id: chatId };
}

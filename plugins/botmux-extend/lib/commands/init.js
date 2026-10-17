// muxboard init —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard init」。

import { requireFlag } from '../args.js';
import { MuxError, ErrorCode } from '../errors.js';
import { Status, PRIORITIES, DEFAULT_PRIORITY } from '../constants.js';
import { formatProgress } from '../progress.js';

/** @type {import('../context.js').CommandRun} */
export async function run({ flags }, ctx) {
  const title = requireFlag(flags, 'title');
  const desc = requireFlag(flags, 'desc');
  const criteria = requireFlag(flags, 'criteria');
  const priority = flags.priority ?? DEFAULT_PRIORITY;
  if (!PRIORITIES.includes(priority)) {
    throw new MuxError(ErrorCode.INVALID_ARGS, `优先级必须是 ${PRIORITIES.join('/')}`);
  }

  // 派发人优先用消息发送人传入的 --from，没有时退回会话发起人
  const dispatcherOpenId = flags.from ?? ctx.env.ownerOpenId;
  const patch = {
    title,
    desc,
    criteria,
    priority,
    status: Status.IN_PROGRESS,
    owner: ctx.env.appId,
    progress: formatProgress(Status.IN_PROGRESS, '创建任务', ctx.now()),
  };
  if (dispatcherOpenId) patch.dispatcher_open_id = dispatcherOpenId;

  const task_id = await ctx.board.createTask(patch);
  return { task_id };
}

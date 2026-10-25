// muxboard unassign —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard unassign」。

import { MuxError, ErrorCode } from '../errors.js';
import { requirePositional } from '../args.js';
import { mention } from '../workchat.js';
import { Status } from '../constants.js';
import { formatProgress } from '../progress.js';

/** @type {import('../context.js').CommandRun} */
export async function run(args, ctx) {
  const id = requirePositional(args.positionals, 0, '子任务ID');
  const note = args.flags.note;

  const child = await ctx.board.getTask(id);
  if (!child.parent_id) {
    throw new MuxError(ErrorCode.NO_WORK_CHAT, `任务 ${id} 没有父任务，无法收回`);
  }
  const parent = await ctx.board.getTask(child.parent_id);
  if (parent.owner !== ctx.env.appId) {
    throw new MuxError(ErrorCode.NOT_DISPATCHER,
      `只有父任务 ${parent.task_id} 的负责人（${parent.owner ?? '无'}）能收回子任务`);
  }
  if (child.status === Status.DONE) {
    throw new MuxError(ErrorCode.TASK_DONE, `任务 ${id} 已完成，不能收回`);
  }
  if (!child.owner) {
    throw new MuxError(ErrorCode.NOT_ASSIGNED, `任务 ${id} 没有负责人，不需要收回`);
  }
  const chatId = parent.work_chat?.chat_id;
  if (!chatId) {
    throw new MuxError(ErrorCode.NO_WORK_CHAT, `父任务 ${parent.task_id} 没有工作群`);
  }

  // 原负责人可能已失联或离群，找不到时照样收回，只是消息里不 @
  const { bots } = await ctx.chat.listMembers(chatId);
  const prev = bots.find((b) => b.app_id === child.owner);
  const who = prev ? mention(prev.open_id, prev.name ?? child.owner) : child.owner;

  await ctx.board.updateTask(id, {
    owner: null,
    status: Status.PENDING,
    progress: formatProgress(Status.PENDING, `已收回${note ? `：${note}` : ''}`, ctx.now()),
  });

  const text = `${who} 任务「${child.title}」（${id}）已收回，请停止处理，不要再更新它的状态` +
    (note ? `\n原因：${note}` : '');
  const messageId = await ctx.chat.send(chatId, text);
  return { task_id: id, previous_owner: child.owner, status: Status.PENDING, message_id: messageId };
}

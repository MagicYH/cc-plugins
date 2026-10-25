// muxboard assign —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard assign」。

import { MuxError, ErrorCode } from '../errors.js';
import { requireFlag, requirePositional } from '../args.js';
import { mention } from '../workchat.js';
import { Status } from '../constants.js';

/** 占用 bot 的状态：已派发未开始、进行中、阻塞都算占用。 */
const BUSY_STATUSES = [Status.PENDING, Status.IN_PROGRESS, Status.BLOCKED];

/** @type {import('../context.js').CommandRun} */
export async function run(args, ctx) {
  const id = requirePositional(args.positionals, 0, '子任务ID');
  const bot = requireFlag(args.flags, 'bot');

  const child = await ctx.board.getTask(id);
  if (!child.parent_id) {
    throw new MuxError(ErrorCode.NO_WORK_CHAT, `任务 ${id} 没有父任务，无法分配`);
  }
  const parent = await ctx.board.getTask(child.parent_id);
  const chatId = parent.work_chat?.chat_id;
  if (!chatId) {
    throw new MuxError(ErrorCode.NO_WORK_CHAT, `父任务 ${parent.task_id} 没有工作群`);
  }

  // 调度检查都在拉人、写负责人之前，失败时不留任何副作用
  if (child.status !== Status.PENDING || child.owner) {
    throw new MuxError(ErrorCode.ALREADY_ASSIGNED,
      `任务 ${id} 已分派（状态：${child.status}，负责人：${child.owner ?? '无'}），不能重复分派`);
  }

  const unfinished = [];
  for (const depId of child.deps) {
    const dep = await ctx.board.getTask(depId);
    if (dep.status !== Status.DONE) unfinished.push(`${depId}（${dep.status}）`);
  }
  if (unfinished.length) {
    throw new MuxError(ErrorCode.DEPS_UNFINISHED, `任务 ${id} 的依赖还没完成：${unfinished.join('、')}`);
  }

  // 一个 bot 同一时间只做一个任务；有子任务的任务是在协调，不算占用
  const busy = [];
  for (const t of await ctx.board.listByOwner(bot, { statuses: BUSY_STATUSES })) {
    if ((await ctx.board.listChildren(t.task_id)).length === 0) busy.push(t);
  }
  if (busy.length) {
    const list = busy.map((t) => `${t.task_id}「${t.title}」（${t.status}）`).join('、');
    throw new MuxError(ErrorCode.BOT_BUSY, `bot ${bot} 正在处理其他任务：${list}，等它完成后再分派`);
  }

  await ctx.chat.addBots(chatId, [bot]);

  const members = await ctx.chat.listMembers(chatId);
  const target = members.bots.find((b) => b.app_id === bot);
  if (!target) {
    throw new MuxError(ErrorCode.BOT_UNRESOLVED, `无法在工作群中找到 bot ${bot}`);
  }

  // 确认 bot 能 @ 到之后再写负责人，避免看板上出现没收到通知的负责人
  await ctx.board.updateTask(id, { owner: bot });

  const text = `${mention(target.open_id, target.name ?? bot)} 你有一个新任务，任务 ID：${id}\n` +
    `请执行 muxboard show ${id} 查看任务详情，然后执行 muxboard start ${id} 开始处理`;
  const messageId = await ctx.chat.send(chatId, text);
  return { task_id: id, owner: bot, message_id: messageId };
}

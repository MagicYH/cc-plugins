// muxboard status —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard status」。

import { MuxError, ErrorCode } from '../errors.js';
import { requirePositional } from '../args.js';
import { Status, SETTABLE_STATUSES } from '../constants.js';
import { formatProgress } from '../progress.js';
import { mention } from '../workchat.js';

/** 通知文案里的状态名。进行中不通知，所以不在这里。 */
const NOTIFY_LABEL = { [Status.DONE]: '已完成', [Status.BLOCKED]: '受阻' };

/** @type {import('../context.js').CommandRun} */
export async function run(args, ctx) {
  const id = requirePositional(args.positionals, 0, '任务ID');
  const status = requirePositional(args.positionals, 1, '状态');
  if (!SETTABLE_STATUSES.includes(status)) {
    throw new MuxError(ErrorCode.INVALID_STATUS, `状态必须是 ${SETTABLE_STATUSES.join('/')}，收到：${status}`);
  }

  const notifies = status in NOTIFY_LABEL;
  const note = args.flags.note;
  if (notifies && !note) {
    throw new MuxError(ErrorCode.NOTE_REQUIRED, `设置为${status}时必须填写 --note`);
  }
  const progressNote = note || '继续处理';

  const t = await ctx.board.getTask(id);
  if (status === Status.DONE) {
    const children = await ctx.board.listChildren(id);
    if (children.some((c) => c.status !== Status.DONE)) {
      throw new MuxError(ErrorCode.CHILDREN_UNFINISHED, '还有未完成的子任务，不能标记为已完成');
    }
  }

  // 先解析通知目标，再写看板，最后发消息：解析失败时看板不会被改。
  const target = notifies ? await resolveNotifyTarget(t, id, NOTIFY_LABEL[status], note, ctx) : null;

  await ctx.board.updateTask(id, {
    status,
    progress: formatProgress(status, progressNote, ctx.now()),
    hostname: ctx.env.hostname,
  });
  if (target) {
    await ctx.chat.send(target.chatId, target.text);
  }
  return { task_id: id, status, notified: target !== null };
}

/**
 * 返回 {chatId, text}；没有通知对象时返回 null。
 * 子任务：在父任务的工作群里通知父任务的负责人 bot。根任务：在根群里 @ 派发人。
 */
async function resolveNotifyTarget(t, id, label, note, ctx) {
  const { board, chat } = ctx;

  if (t.parent_id) {
    const parent = await board.getTask(t.parent_id);
    const chatId = parent.work_chat?.chat_id;
    if (!chatId) {
      throw new MuxError(ErrorCode.NO_WORK_CHAT, `父任务 ${parent.task_id} 没有工作群`);
    }
    const { bots } = await chat.listMembers(chatId);
    const bot = bots.find((b) => b.app_id === parent.owner);
    if (!bot) {
      throw new MuxError(ErrorCode.BOT_UNRESOLVED, `无法在工作群中找到父任务负责人 ${parent.owner}`);
    }
    const text = `${mention(bot.open_id, bot.name ?? parent.owner)} 任务「${t.title}」（${id}）${label}：${note}\n` +
      `请执行 muxboard show ${id} 查看结果，并用 muxboard children ${parent.task_id} 检查所有子任务的状态，` +
      `然后按调度规则派发下一个可派发任务（muxboard children ${parent.task_id} --ready）`;
    return { chatId, text };
  }

  // 根任务的工作群就是根群；旧数据可能没有，这时不通知
  if (!t.work_chat) {
    return null;
  }
  const prefix = t.dispatcher ? `${mention(t.dispatcher.open_id, t.dispatcher.name ?? '派发人')} ` : '';
  const text = `${prefix}任务「${t.title}」（${id}）${label}：${note}\n查看详情：muxboard show ${id}`;
  return { chatId: t.work_chat.chat_id, text };
}

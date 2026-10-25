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

  // 根任务的群就是当前群，必须是普通群（不是单聊、不是话题群）
  const chatId = ctx.env.chatId;
  if (!chatId) {
    throw new MuxError(ErrorCode.NOT_IN_BOTMUX, '缺少 BOTMUX_CHAT_ID');
  }
  await assertNormalGroup(chatId, ctx);

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
    work_chat_id: chatId,
    hostname: ctx.env.hostname,
  };
  if (dispatcherOpenId) patch.dispatcher_open_id = dispatcherOpenId;

  // 还没有看板时，确认群合法后再新建，避免单聊等情况下白建一张表
  let { board, boardUrl: url } = ctx;
  if (!board) ({ board, url } = await ctx.provisionBoard());

  const task_id = await board.createTask(patch);
  if (url) {
    await ctx.chat.send(chatId, `已创建根任务「${title}」（${task_id}），任务看板：${url}`);
  }
  return { task_id, chat_id: chatId, url };
}

async function assertNormalGroup(chatId, ctx) {
  const notGroup = (reason) =>
    new MuxError(ErrorCode.NOT_GROUP_CHAT, `${reason}，只能在普通群里创建根任务`);
  if (ctx.env.chatType === 'p2p') throw notGroup('当前是单聊');
  const info = await ctx.chat.getInfo(chatId);
  // bot 不在群里或群已解散时，接口只返回少量字段，读不到群模式
  if (!info.chat_mode) throw notGroup('读不到当前群的信息（群可能已解散，或 bot 不在群里）');
  if (info.chat_mode !== 'group') throw notGroup(`当前群模式是 ${info.chat_mode}`);
  if (info.group_message_type === 'thread') throw notGroup('当前群是话题模式');
}

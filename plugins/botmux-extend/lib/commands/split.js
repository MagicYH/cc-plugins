// muxboard split —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard split」。

import { MuxError, ErrorCode } from '../errors.js';
import { requirePositional } from '../args.js';
import { MAX_CHAT_USERS } from '../constants.js';
import { chatName, formatDescription, introMessage } from '../workchat.js';

/** @type {import('../context.js').CommandRun} */
export async function run(args, ctx) {
  const id = requirePositional(args.positionals, 0, '任务ID');
  const { board, chat, env } = ctx;

  const t = await board.getTask(id);
  if (!t.parent_id) {
    throw new MuxError(ErrorCode.INVALID_ARGS, `任务 ${id} 是根任务，它的工作群就是 init 所在的群，不需要 split`);
  }
  if (t.work_chat) {
    return { task_id: id, chat_id: t.work_chat.chat_id, chat_created: false, bots: [] };
  }

  const parent = await board.getTask(t.parent_id);
  const upperChatId = parent.work_chat?.chat_id;
  if (!upperChatId) {
    throw new MuxError(ErrorCode.NO_WORK_CHAT, `父任务 ${parent.task_id} 没有工作群，无法为 ${id} 建群`);
  }

  let root = parent;
  while (root.parent_id) {
    root = await board.getTask(root.parent_id);
  }

  // 上级群里的人和 bot 都拉进新群；建群的 bot 自己已经在群里
  const members = await chat.listMembers(upperChatId);
  const userOpenIds = members.users.slice(0, MAX_CHAT_USERS).map((u) => u.open_id);
  const botAppIds = members.bots.map((b) => b.app_id).filter((appId) => appId !== env.appId);

  const chatId = await chat.create({
    name: chatName(root.title, t.title),
    description: formatDescription({ taskId: id, upperChatId }),
    userOpenIds,
  });
  await chat.addBots(chatId, botAppIds);
  await board.updateTask(id, { work_chat_id: chatId, hostname: env.hostname });
  await chat.send(chatId, introMessage({ taskId: id, taskTitle: t.title, upperChatId }));
  return { task_id: id, chat_id: chatId, chat_created: true, bots: botAppIds };
}

// muxboard add —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard add」。

import { MuxError, ErrorCode } from '../errors.js';
import { requireFlag, requirePositional } from '../args.js';
import { Status, PRIORITIES, DEFAULT_PRIORITY, MAX_CHAT_USERS } from '../constants.js';
import { chatName, formatDescription, introMessage } from '../workchat.js';

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

  const parent = await ctx.board.getTask(parentId);
  let chatId = parent.work_chat?.chat_id;
  const chatCreated = !chatId;
  if (chatCreated) {
    chatId = await createWorkChat(parent, ctx);
  }

  const taskId = await ctx.board.createTask({
    title,
    desc,
    criteria,
    priority,
    status: Status.PENDING,
    parent_id: parent.task_id,
  });
  return { task_id: taskId, chat_id: chatId, chat_created: chatCreated };
}

/**
 * 为还没有工作群的父任务建群，写回 work_chat_id，并发说明消息。返回新群的 chat_id。
 * 上级群：父任务有上级时取上级任务的工作群；父任务是根任务时取当前会话所在群。
 */
async function createWorkChat(parent, ctx) {
  const { board, chat, env } = ctx;

  let upperChatId;
  if (parent.parent_id) {
    const grand = await board.getTask(parent.parent_id);
    upperChatId = grand.work_chat?.chat_id;
    if (!upperChatId) {
      throw new MuxError(ErrorCode.NO_WORK_CHAT, `上级任务 ${grand.task_id} 没有工作群，无法为 ${parent.task_id} 建群`);
    }
  } else {
    upperChatId = env.chatId;
    if (!upperChatId) {
      throw new MuxError(ErrorCode.NOT_IN_BOTMUX, '缺少 BOTMUX_CHAT_ID');
    }
  }

  let root = parent;
  while (root.parent_id) {
    root = await board.getTask(root.parent_id);
  }

  const { users } = await chat.listMembers(upperChatId);
  const userOpenIds = users.slice(0, MAX_CHAT_USERS).map((u) => u.open_id);

  const chatId = await chat.create({
    name: chatName(root.title, parent.parent_id ? parent.title : null),
    description: formatDescription({ taskId: parent.task_id, upperChatId }),
    userOpenIds,
  });
  await board.updateTask(parent.task_id, { work_chat_id: chatId });
  await chat.send(chatId, introMessage({ taskId: parent.task_id, taskTitle: parent.title, upperChatId }));
  return chatId;
}

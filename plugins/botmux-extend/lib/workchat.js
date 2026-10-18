// split 新建的工作群：群名、群描述和说明消息。群描述用固定格式记下"任务 ID + 上级群 ID"，
// 方便人和 bot 在群里看出这是哪个任务的群。

/** 群描述，约 60 个字符，飞书上限 100。 */
export function formatDescription({ taskId, upperChatId }) {
  return `muxboard task=${taskId} upper=${upperChatId}`;
}

/** 群名："根任务标题 - 该任务标题"。 */
export function chatName(rootTitle, taskTitle) {
  return `${rootTitle} - ${taskTitle}`;
}

/** 建群后发在群里的说明消息。 */
export function introMessage({ taskId, taskTitle, upperChatId }) {
  return [
    `本群是任务「${taskTitle}」（${taskId}）的工作群，上级群：${upperChatId}。`,
    `查看任务详情：muxboard show ${taskId}`,
  ].join('\n');
}

/** 飞书文本消息里的 @。 */
export function mention(openId, name) {
  return `<at user_id="${openId}">${name}</at>`;
}

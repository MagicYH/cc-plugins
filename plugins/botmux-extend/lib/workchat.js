// 工作群的群名、群描述和说明消息。群描述用固定格式记下"任务 ID + 上级群 ID"，
// 根任务完成时 status 命令从这里读出来源群。

const DESC_RE = /muxboard task=(rec\w+) upper=(oc_\w+)/;

/** 群描述，约 60 个字符，飞书上限 100。 */
export function formatDescription({ taskId, upperChatId }) {
  return `muxboard task=${taskId} upper=${upperChatId}`;
}

/** 解析群描述；不是 muxboard 写的描述返回 null。 */
export function parseDescription(description) {
  const m = DESC_RE.exec(description ?? '');
  return m ? { taskId: m[1], upperChatId: m[2] } : null;
}

/** 群名：父任务就是根任务时只用根任务标题。 */
export function chatName(rootTitle, parentTitle) {
  return parentTitle ? `${rootTitle} - ${parentTitle}` : rootTitle;
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

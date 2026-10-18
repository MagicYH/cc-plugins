// 飞书群操作。只通过注入的 LarkRunner 调用 lark-cli，不直接访问网络。
//
// 实测的 lark-cli 行为（2026-10-17）：
// - 建群：`im +chat-create --name N --description D [--users ou_a,ou_b] [--bots cli_a,cli_b]`
//   返回 data = { chat_id: "oc_x", name, ... }。--users 最多 50 个，--bots 最多 5 个。
// - 读群信息：`im chats get --chat-id oc_x`，返回 data.name、data.description、
//   data.chat_mode（普通群为 "group"，话题群为 "topic"）、data.group_message_type（"chat" 或话题模式 "thread"）。
// - 查成员：`im +chat-members-list --chat-id oc_x --page-all`
//   返回 data = { users: [{member_id: "ou_x", name, ...}], bots: [{app_id: "cli_x", member_id: "ou_y", name}] }。
//   bots[].member_id 是这个 bot 在调用方应用下的 open_id，@ 时用它。
// - 拉 bot 入群：`im chat.members create --chat-id oc_x --member-id-type app_id --succeed-type 1
//   --data '{"id_list":["cli_x"]}'`。bot 已在群里时也返回成功。
// - 发消息：`im +messages-send --chat-id oc_x --text '<at user_id="ou_x">名称</at> 内容'`
//   返回 data = { message_id: "om_x", ... }。

/**
 * @typedef {Object} ChatMembers
 * @property {{open_id: string, name: string|null}[]} users
 * @property {{app_id: string, open_id: string, name: string|null}[]} bots
 */

/**
 * @typedef {Object} ChatInfo
 * @property {string|null} name
 * @property {string|null} chat_mode           普通群为 "group"
 * @property {string|null} group_message_type  话题模式为 "thread"
 */

/**
 * @typedef {Object} Chat
 * @property {(opts: {name: string, description: string, userOpenIds?: string[], botAppIds?: string[]}) => Promise<string>} create  返回 chat_id
 * @property {(chatId: string) => Promise<ChatInfo>} getInfo
 * @property {(chatId: string) => Promise<ChatMembers>} listMembers
 * @property {(chatId: string, appIds: string[]) => Promise<void>} addBots
 * @property {(chatId: string, text: string) => Promise<string>} send  返回 message_id
 */

/**
 * @param {import('./lark.js').LarkRunner} run
 * @returns {Chat}
 */
export function createChat(run) {
  return {
    async create({ name, description, userOpenIds = [], botAppIds = [] }) {
      const args = ['im', '+chat-create', '--name', name, '--description', description];
      if (userOpenIds.length) args.push('--users', userOpenIds.join(','));
      if (botAppIds.length) args.push('--bots', botAppIds.join(','));
      const data = await run(args);
      return data.chat_id;
    },

    async getInfo(chatId) {
      const data = await run(['im', 'chats', 'get', '--chat-id', chatId]);
      return {
        name: data.name ?? null,
        chat_mode: data.chat_mode ?? null,
        group_message_type: data.group_message_type ?? null,
      };
    },

    async listMembers(chatId) {
      const data = await run(['im', '+chat-members-list', '--chat-id', chatId, '--page-all']);
      return {
        users: (data.users ?? []).map((u) => ({ open_id: u.member_id, name: u.name ?? null })),
        bots: (data.bots ?? []).map((b) => ({ app_id: b.app_id, open_id: b.member_id, name: b.name ?? null })),
      };
    },

    async addBots(chatId, appIds) {
      if (!appIds.length) return;
      await run([
        'im', 'chat.members', 'create',
        '--chat-id', chatId,
        '--member-id-type', 'app_id',
        '--succeed-type', '1',
        '--data', JSON.stringify({ id_list: appIds }),
      ]);
    },

    async send(chatId, text) {
      const data = await run(['im', '+messages-send', '--chat-id', chatId, '--text', text]);
      return data.message_id;
    },
  };
}

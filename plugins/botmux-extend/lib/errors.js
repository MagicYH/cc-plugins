// 所有可预期的失败都抛 MuxError，由 cli.js 统一转成 {"ok": false, "error": {...}}。
export class MuxError extends Error {
  /**
   * @param {string} code 错误码，见 docs/task-board-design.md「错误码汇总」
   * @param {string} message 给 bot 看的说明
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const ErrorCode = Object.freeze({
  NOT_IN_BOTMUX: 'not_in_botmux',
  NOT_GROUP_CHAT: 'not_group_chat',
  INVALID_ARGS: 'invalid_args',
  NOT_FOUND: 'not_found',
  INVALID_STATUS: 'invalid_status',
  NOTE_REQUIRED: 'note_required',
  CHILDREN_UNFINISHED: 'children_unfinished',
  NO_WORK_CHAT: 'no_work_chat',
  BOT_UNRESOLVED: 'bot_unresolved',
  LARK_ERROR: 'lark_error',
});

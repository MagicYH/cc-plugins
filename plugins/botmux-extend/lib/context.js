/**
 * 命令运行时拿到的依赖。真实运行由 cli.js 组装；测试里传假对象。
 * @typedef {Object} Ctx
 * @property {import('./board.js').Board|null} board  看板配置缺失时为 null（只有 init 会遇到）
 * @property {string|null} boardUrl  多维表格链接
 * @property {() => Promise<{board: import('./board.js').Board, url: string|null}>} provisionBoard
 *   按模板新建看板、给会话发起人授权，并写入用户配置
 * @property {import('./chat.js').Chat} chat
 * @property {{appId: string, chatId: string|undefined, chatType: string|undefined, ownerOpenId: string|undefined, hostname: string}} env
 *   appId ← BOTMUX_LARK_APP_ID（cli.js 已保证存在）
 *   chatId ← BOTMUX_CHAT_ID（当前会话所在群）
 *   chatType ← BOTMUX_CHAT_TYPE（group / p2p）
 *   ownerOpenId ← BOTMUX_OWNER_OPEN_ID（会话发起人）
 *   hostname ← os.hostname()（当前 bot 所在主机）
 * @property {() => Date} now
 */

/**
 * 每个命令模块导出：
 *   export async function run(args, ctx): Promise<object>
 * args = { positionals: string[], flags: Record<string,string> }（positionals 不含命令名）
 * 返回值会被 cli.js 包成 {"ok": true, "data": <返回值>}；失败时抛 MuxError。
 * @typedef {(args: {positionals: string[], flags: Record<string,string>}, ctx: Ctx) => Promise<object>} CommandRun
 */

export {};

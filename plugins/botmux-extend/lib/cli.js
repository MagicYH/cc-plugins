import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import { MuxError, ErrorCode } from './errors.js';
import { createLarkRunner } from './lark.js';
import { createBoard } from './board.js';
import { createChat } from './chat.js';

const COMMANDS = ['init', 'show', 'start', 'children', 'add', 'assign', 'status', 'output'];

const USAGE = `muxboard <命令> [参数]

命令：
  init --title --desc --criteria [--priority] [--from <open_id>]   创建根任务
  show <任务ID>                                                     查看任务详情
  start <任务ID>                                                    开始处理任务
  children <任务ID> [--status <状态>]                               查看子任务
  add <父任务ID> --title --desc --criteria [--priority]             创建子任务
  assign <子任务ID> --bot <app_id>                                  分派子任务
  status <任务ID> <进行中|阻塞|已完成> [--note <说明>]              更新状态
  output <任务ID> <内容>                                            写入产出`;

function loadConfig() {
  const path = fileURLToPath(new URL('../config/board.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

/**
 * @param {string[]} argv 不含 node 和脚本路径
 * @returns {Promise<number>} 退出码
 */
export async function main(argv, env = process.env) {
  try {
    const { command, positionals, flags } = parseArgs(argv);
    if (!command || command === 'help' || flags.help !== undefined) {
      process.stdout.write(USAGE + '\n');
      return 0;
    }
    if (!COMMANDS.includes(command)) {
      throw new MuxError(ErrorCode.INVALID_ARGS, `未知命令 ${command}，可用命令：${COMMANDS.join(', ')}`);
    }
    if (!env.BOTMUX_LARK_APP_ID) {
      throw new MuxError(ErrorCode.NOT_IN_BOTMUX, '缺少环境变量 BOTMUX_LARK_APP_ID，muxboard 只能在 botmux 会话里运行');
    }
    const run = createLarkRunner();
    const ctx = {
      board: createBoard(run, loadConfig()),
      chat: createChat(run),
      env: { appId: env.BOTMUX_LARK_APP_ID, chatId: env.BOTMUX_CHAT_ID, ownerOpenId: env.BOTMUX_OWNER_OPEN_ID },
      now: () => new Date(),
    };
    const mod = await import(`./commands/${command}.js`);
    const data = await mod.run({ positionals, flags }, ctx);
    print({ ok: true, data });
    return 0;
  } catch (err) {
    const error = err instanceof MuxError
      ? { code: err.code, message: err.message }
      : { code: 'internal_error', message: String(err?.stack ?? err) };
    print({ ok: false, error });
    return 1;
  }
}

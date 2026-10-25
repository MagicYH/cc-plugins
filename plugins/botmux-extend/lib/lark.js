import { execFile } from 'node:child_process';
import { MuxError, ErrorCode } from './errors.js';

/**
 * @typedef {(args: string[]) => Promise<any>} LarkRunner
 * 执行一条 lark-cli 命令（自动追加 `--as bot`，需要时再追加 `--profile <app_id>`），返回输出 JSON 的 `data` 字段。
 * lark-cli 返回 ok:false、退出码非 0 或输出不是 JSON 时，抛 MuxError(lark_error)。
 * board.js / chat.js 只依赖这个函数签名，测试里用假的 runner 替换。
 */

/**
 * 当前 bot 的 profile：多 bot 协作时每次调用都用自己的身份，不依赖、也不修改 lark-cli 的全局默认 profile。
 * botmux 会话里 PATH 上的 `lark-cli` 是 botmux 托管的入口，已绑定当前 bot（BOTMUX_LARK_TOOL_BINDING），
 * 不再加 --profile；用 MUXBOARD_LARK_BIN 指定了其他程序，或不经过托管入口时，按 BOTMUX_LARK_APP_ID 加 --profile。
 */
export function defaultProfile(env = process.env) {
  if (env.BOTMUX_LARK_TOOL_BINDING && !env.MUXBOARD_LARK_BIN) return undefined;
  return env.BOTMUX_LARK_APP_ID || undefined;
}

/** @returns {LarkRunner} */
export function createLarkRunner(bin = process.env.MUXBOARD_LARK_BIN || 'lark-cli', profile = defaultProfile()) {
  const identity = ['--as', 'bot', ...(profile ? ['--profile', profile] : [])];
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, [...args, ...identity], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        let parsed;
        try {
          // 出错时 lark-cli 把错误 JSON 写到 stderr
          parsed = JSON.parse(stdout || stderr);
        } catch {
          const detail = (stderr || stdout || err?.message || '').trim();
          reject(new MuxError(ErrorCode.LARK_ERROR, `lark-cli ${args[0]} ${args[1] ?? ''} 失败：${detail}`));
          return;
        }
        if (!parsed.ok) {
          const error = parsed.error ?? parsed;
          if (error.field === '--profile') {
            reject(new MuxError(ErrorCode.LARK_ERROR,
              `lark-cli 没有当前 bot 的 profile「${profile}」，请先用该 bot 的凭证添加：` +
              `lark-cli profile add --name ${profile} --app-id ${profile} --app-secret-stdin（不要加 --use）`));
            return;
          }
          reject(new MuxError(ErrorCode.LARK_ERROR, JSON.stringify(error)));
          return;
        }
        resolve(parsed.data);
      });
    });
}

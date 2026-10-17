import { execFile } from 'node:child_process';
import { MuxError, ErrorCode } from './errors.js';

/**
 * @typedef {(args: string[]) => Promise<any>} LarkRunner
 * 执行一条 lark-cli 命令（自动追加 `--as bot`），返回输出 JSON 的 `data` 字段。
 * lark-cli 返回 ok:false、退出码非 0 或输出不是 JSON 时，抛 MuxError(lark_error)。
 * board.js / chat.js 只依赖这个函数签名，测试里用假的 runner 替换。
 */

/** @returns {LarkRunner} */
export function createLarkRunner(bin = process.env.MUXBOARD_LARK_BIN || 'lark-cli') {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, [...args, '--as', 'bot'], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          const detail = (stderr || stdout || err?.message || '').trim();
          reject(new MuxError(ErrorCode.LARK_ERROR, `lark-cli ${args[0]} ${args[1] ?? ''} 失败：${detail}`));
          return;
        }
        if (!parsed.ok) {
          reject(new MuxError(ErrorCode.LARK_ERROR, JSON.stringify(parsed.error ?? parsed)));
          return;
        }
        resolve(parsed.data);
      });
    });
}

import { MuxError, ErrorCode } from './errors.js';

/**
 * 解析命令行参数。`--key value` 和 `--key=value` 都支持；其余是位置参数。
 * @param {string[]} argv 不含 node 和脚本路径
 * @returns {{command: string|undefined, positionals: string[], flags: Record<string,string>}}
 */
export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new MuxError(ErrorCode.INVALID_ARGS, `参数 ${arg} 缺少取值`);
    }
    flags[arg.slice(2)] = next;
    i++;
  }
  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

/** 取必填的 flag，缺失时抛 invalid_args。 */
export function requireFlag(flags, name) {
  const value = flags[name];
  if (value === undefined || value === '') {
    throw new MuxError(ErrorCode.INVALID_ARGS, `缺少参数 --${name}`);
  }
  return value;
}

/** 取第 index 个位置参数，缺失时抛 invalid_args。 */
export function requirePositional(positionals, index, label) {
  const value = positionals[index];
  if (value === undefined || value === '') {
    throw new MuxError(ErrorCode.INVALID_ARGS, `缺少参数 <${label}>`);
  }
  return value;
}

// muxboard children —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard children」。

import { requirePositional } from '../args.js';
import { MuxError, ErrorCode } from '../errors.js';
import { Status, PRIORITIES } from '../constants.js';

const priorityRank = (p) => (PRIORITIES.includes(p) ? PRIORITIES.indexOf(p) : PRIORITIES.length);

/** @type {import('../context.js').CommandRun} */
export async function run({ positionals, flags }, ctx) {
  const id = requirePositional(positionals, 0, '任务ID');
  const status = flags.status;
  if (status !== undefined && !Object.values(Status).includes(status)) {
    throw new MuxError(ErrorCode.INVALID_STATUS, `状态必须是 ${Object.values(Status).join('/')}`);
  }

  // 先确认父任务存在，不存在时 board 会抛 not_found
  await ctx.board.getTask(id);
  const list = status === undefined
    ? await ctx.board.listChildren(id)
    : await ctx.board.listChildren(id, { status });

  // 依赖的状态：兄弟任务直接用列表里的；带 --status 过滤时不在列表里的再单独查
  const statusOf = new Map(list.map((c) => [c.task_id, c.status]));
  for (const depId of new Set(list.flatMap((c) => c.deps))) {
    if (!statusOf.has(depId)) statusOf.set(depId, (await ctx.board.getTask(depId)).status);
  }

  // ready：待分配、没有负责人、依赖全部已完成，可以立即分派
  const rows = list.map((c, order) => ({
    order,
    ready: c.status === Status.PENDING && !c.owner && c.deps.every((d) => statusOf.get(d) === Status.DONE),
    c,
  }));
  rows.sort((a, b) => (b.ready - a.ready) || (priorityRank(a.c.priority) - priorityRank(b.c.priority)) || (a.order - b.order));

  return {
    children: rows
      .filter((r) => flags.ready === undefined || r.ready)
      .map(({ ready, c }) => ({
        task_id: c.task_id,
        title: c.title,
        priority: c.priority,
        owner: c.owner,
        status: c.status,
        deps: c.deps,
        ready,
        progress: c.progress,
        output: c.output,
        updated_at: c.updated_at,
        hostname: c.hostname,
      })),
  };
}

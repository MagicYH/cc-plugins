// muxboard show —— 行为见 docs/task-board-design.md 第 6.2 节「muxboard show」。

import { requirePositional } from '../args.js';
import { Status } from '../constants.js';

/** @type {import('../context.js').CommandRun} */
export async function run({ positionals }, ctx) {
  const id = requirePositional(positionals, 0, '任务ID');
  const t = await ctx.board.getTask(id);

  let parent = null;
  if (t.parent_id) {
    const p = await ctx.board.getTask(t.parent_id);
    parent = { task_id: p.task_id, title: p.title, owner: p.owner, status: p.status };
  }

  const children = await ctx.board.listChildren(id);
  return {
    task_id: t.task_id,
    title: t.title,
    desc: t.desc,
    criteria: t.criteria,
    priority: t.priority,
    status: t.status,
    owner: t.owner,
    progress: t.progress,
    output: t.output,
    work_chat: t.work_chat,
    dispatcher: t.dispatcher,
    updated_at: t.updated_at,
    hostname: t.hostname,
    deps: t.deps,
    parent,
    children: {
      total: children.length,
      done: children.filter((c) => c.status === Status.DONE).length,
    },
  };
}

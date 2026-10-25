// 看板（多维表格）读写。只通过注入的 LarkRunner 调用 lark-cli，不直接访问网络。
//
// 实测的 lark-cli 行为（2026-10-17）：
// - 读：`base +record-get --base-token B --table-id T --record-id R --format json`
//   返回 data = { data: [[...每行的单元格]], field_id_list: [...], record_id_list: [...],
//   record_not_found?: [...] }。单元格顺序与 field_id_list 一致。记录不存在时 ok 仍为 true，
//   但 record_not_found 里有这个 ID。
// - 列表：`base +record-list --base-token B --table-id T --format json
//   --filter-json '{"logic":"and","conditions":[["<父任务字段ID>","intersects",[{"id":"recXXX"}]]]}'`
//   返回结构同上（无 record_not_found）。`--format json` 默认最多 100 条，用 `--limit 200`。
//   文本字段（负责人）按值精确过滤用 `["<字段ID>","==","cli_x"]`（2026-10-25 实测）。
// - 新建：`base +record-upsert --base-token B --table-id T --json '<字段ID→值>'`
//   返回 data = { created: true, record: { record_id_list: ["recXXX"] } }。
// - 更新：同上加 `--record-id R`，只写传入的字段。
// - 单元格格式：
//   text → "字符串" 或 null
//   select（状态、优先级）→ ["进行中"] 或 []，写入也用数组
//   user（派发人）→ [{"id":"ou_x","name":"张三"}]，写入用 [{"id":"ou_x"}]
//   group_chat（工作群）→ [{"id":"oc_x","name":"群名"}]，写入用 [{"id":"oc_x"}]
//   link（父任务、依赖）→ [{"id":"recX"}, ...]，写入同样格式
//   updated_at（修改时间）→ "2026-10-17T16:05:12.000+04:00"，只读

import { MuxError, ErrorCode } from './errors.js';

/**
 * @typedef {Object} Task
 * @property {string} task_id
 * @property {string|null} title
 * @property {string|null} desc
 * @property {string|null} criteria
 * @property {string|null} priority      高/中/低
 * @property {string|null} status        待分配/进行中/阻塞/已完成
 * @property {string|null} owner         负责人 bot 的 app_id
 * @property {string|null} progress      当前进展
 * @property {string|null} output        产出
 * @property {{chat_id: string, name: string|null}|null} work_chat
 * @property {string|null} parent_id
 * @property {{open_id: string, name: string|null}|null} dispatcher  派发人
 * @property {string|null} updated_at
 * @property {string|null} hostname      最近一次操作该任务的 bot 所在主机
 * @property {string[]} deps              依赖的任务 ID，全部完成后才能分派
 */

/**
 * 写入时的字段，全部可选；只写出现的键。值为 null 表示清空。
 * @typedef {Object} TaskPatch
 * @property {string} [title]
 * @property {string} [desc]
 * @property {string} [criteria]
 * @property {string} [priority]
 * @property {string} [status]
 * @property {string} [owner]
 * @property {string} [progress]
 * @property {string} [output]
 * @property {string} [work_chat_id]
 * @property {string} [parent_id]
 * @property {string} [dispatcher_open_id]
 * @property {string} [hostname]
 * @property {string[]} [deps]
 */

/**
 * @typedef {Object} Board
 * @property {(taskId: string) => Promise<Task>} getTask  不存在时抛 not_found
 * @property {(taskId: string, opts?: {status?: string}) => Promise<Task[]>} listChildren  直接子任务
 * @property {(appId: string, opts?: {statuses?: string[]}) => Promise<Task[]>} listByOwner  负责人是该 bot 的任务
 * @property {(patch: TaskPatch) => Promise<string>} createTask  返回新记录 ID
 * @property {(taskId: string, patch: TaskPatch) => Promise<void>} updateTask
 */

/**
 * @param {import('./lark.js').LarkRunner} run
 * @param {import('./config.js').BoardConfig} config  用户配置，见 config.js
 * @returns {Board}
 */
export function createBoard(run, config) {
  const { base_token, table_id, fields } = config;
  const base = ['--base-token', base_token, '--table-id', table_id];
  // 字段 ID → 逻辑名，读取时用
  const idToName = Object.fromEntries(Object.entries(fields).map(([name, id]) => [id, name]));

  // 把一行单元格按 field_id_list 映射成 Task
  function rowToTask(taskId, cells, fieldIdList) {
    const task = {
      task_id: taskId, title: null, desc: null, criteria: null, priority: null, status: null,
      owner: null, progress: null, output: null, work_chat: null, parent_id: null,
      dispatcher: null, updated_at: null, hostname: null, deps: [],
    };
    fieldIdList.forEach((fid, i) => {
      const name = idToName[fid];
      if (!name) return;
      const cell = cells[i];
      switch (name) {
        case 'status':
        case 'priority':
          task[name] = cell?.[0] ?? null;
          break;
        case 'work_chat':
          task.work_chat = cell?.[0] ? { chat_id: cell[0].id, name: cell[0].name ?? null } : null;
          break;
        case 'parent':
          task.parent_id = cell?.[0]?.id ?? null;
          break;
        case 'deps':
          task.deps = (cell ?? []).map((r) => r.id);
          break;
        case 'dispatcher':
          task.dispatcher = cell?.[0] ? { open_id: cell[0].id, name: cell[0].name ?? null } : null;
          break;
        default:
          task[name] = cell ?? null;
      }
    });
    return task;
  }

  // TaskPatch 的键 → [字段逻辑名, 写入格式函数]
  const asText = (v) => v;
  const asSelect = (v) => (v === null ? null : [v]);
  const asRef = (v) => (v === null ? null : [{ id: v }]);
  const asRefs = (v) => (v === null ? null : v.map((id) => ({ id })));
  const WRITERS = {
    title: ['title', asText],
    desc: ['desc', asText],
    criteria: ['criteria', asText],
    progress: ['progress', asText],
    output: ['output', asText],
    owner: ['owner', asText],
    priority: ['priority', asSelect],
    status: ['status', asSelect],
    work_chat_id: ['work_chat', asRef],
    parent_id: ['parent', asRef],
    dispatcher_open_id: ['dispatcher', asRef],
    hostname: ['hostname', asText],
    deps: ['deps', asRefs],
  };

  // TaskPatch → 字段ID→单元格值，只包含 patch 里出现的键。
  // 配置里没有的字段（旧配置缺 hostname、deps）直接跳过，不写入。
  function patchToCells(patch) {
    const cells = {};
    for (const [key, value] of Object.entries(patch)) {
      const writer = WRITERS[key];
      if (!writer) continue;
      const [name, format] = writer;
      if (!fields[name]) continue;
      cells[fields[name]] = format(value);
    }
    return cells;
  }

  async function listWhere(conditions) {
    const filter = { logic: 'and', conditions };
    const data = await run([
      'base', '+record-list', ...base, '--format', 'json', '--limit', '200',
      '--filter-json', JSON.stringify(filter),
    ]);
    return (data.data ?? []).map((row, i) => rowToTask(data.record_id_list[i], row, data.field_id_list));
  }

  return {
    async getTask(taskId) {
      const data = await run(['base', '+record-get', ...base, '--record-id', taskId, '--format', 'json']);
      const row = data.data?.[0];
      if (!row || data.record_not_found?.includes(taskId)) {
        throw new MuxError(ErrorCode.NOT_FOUND, `任务 ${taskId} 不存在`);
      }
      return rowToTask(taskId, row, data.field_id_list);
    },

    async listChildren(taskId, opts = {}) {
      const conditions = [[fields.parent, 'intersects', [{ id: taskId }]]];
      if (opts.status) conditions.push([fields.status, 'intersects', [opts.status]]);
      return listWhere(conditions);
    },

    async listByOwner(appId, opts = {}) {
      const conditions = [[fields.owner, '==', appId]];
      if (opts.statuses) conditions.push([fields.status, 'intersects', opts.statuses]);
      return listWhere(conditions);
    },

    async createTask(patch) {
      const data = await run(['base', '+record-upsert', ...base, '--json', JSON.stringify(patchToCells(patch))]);
      return data.record.record_id_list[0];
    },

    async updateTask(taskId, patch) {
      await run(['base', '+record-upsert', ...base, '--record-id', taskId, '--json', JSON.stringify(patchToCells(patch))]);
    },
  };
}

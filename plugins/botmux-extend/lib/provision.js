// 按模板新建看板（多维表格）。只通过注入的 LarkRunner 调用 lark-cli。
//
// 用到的 lark-cli 命令（2026-10-18 按 help 和 dry-run 确认）：
// - 建 base 和首表：`base +base-create --name N --table-name T --fields '<字段定义数组>'`
//   第一个字段是主字段。新 base 的 token 取 data.base.base_token。
// - 查表：`base +table-list --base-token B`，返回 data.tables = [{id, name}]。
// - 建字段：`base +field-create --base-token B --table-id T --json '<字段定义数组>'`。
//   父任务、依赖关联本表，要等表建好、拿到 table_id 后再建。
// - 查字段：`base +field-list --base-token B --table-id T`，返回 data.fields = [{id, name, type}]。
// - 读链接：`base +base-get --base-token B`，返回 data.base.url。
// - 授权：`drive +member-add --token B --type bitable --member-type openid --member-id ou_x
//   --perm full_access --yes`（high-risk-write，必须带 --yes）。

import { MuxError, ErrorCode } from './errors.js';

/**
 * @param {import('./lark.js').LarkRunner} run
 * @param {import('./config.js').BoardTemplate} template
 * @param {{ownerOpenId?: string}} opts  ownerOpenId 有值时给它加管理权限
 * @returns {Promise<import('./config.js').BoardConfig>}
 */
export async function provisionBoard(run, template, { ownerOpenId } = {}) {
  const defs = Object.values(template.fields);
  const plain = defs.filter((f) => f.type !== 'link');
  const links = defs.filter((f) => f.type === 'link');

  const created = await run([
    'base', '+base-create', '--name', template.base_name,
    '--table-name', template.table_name, '--fields', JSON.stringify(plain),
  ]);
  const base_token = created.base?.base_token ?? created.base_token;
  if (!base_token) {
    throw new MuxError(ErrorCode.LARK_ERROR, `新建多维表格后取不到 base_token：${JSON.stringify(created)}`);
  }
  const base = ['--base-token', base_token];

  const { tables = [] } = await run(['base', '+table-list', ...base]);
  const table = tables.find((t) => t.name === template.table_name) ?? tables[0];
  if (!table) {
    throw new MuxError(ErrorCode.LARK_ERROR, `新建的多维表格 ${base_token} 里没有数据表`);
  }
  const table_id = table.id;

  if (links.length) {
    const linkDefs = links.map((f) => ({ ...f, link_table: table_id }));
    await run(['base', '+field-create', ...base, '--table-id', table_id, '--json', JSON.stringify(linkDefs)]);
  }

  // 按字段名找回字段 ID
  const { fields: list = [] } = await run(['base', '+field-list', ...base, '--table-id', table_id]);
  const idByName = Object.fromEntries(list.map((f) => [f.name, f.id]));
  const fields = {};
  for (const [key, def] of Object.entries(template.fields)) {
    if (!idByName[def.name]) {
      throw new MuxError(ErrorCode.LARK_ERROR, `新建的数据表里找不到字段「${def.name}」`);
    }
    fields[key] = idByName[def.name];
  }

  const info = await run(['base', '+base-get', ...base]);
  const url = info.base?.url ?? null;

  if (ownerOpenId) {
    await run([
      'drive', '+member-add', '--token', base_token, '--type', 'bitable',
      '--member-type', 'openid', '--member-id', ownerOpenId, '--perm', 'full_access', '--yes',
    ]);
  }

  return { base_token, table_id, fields, url };
}

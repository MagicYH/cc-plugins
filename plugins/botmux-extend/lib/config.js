// 看板配置：用户配置记录正在用的多维表格，插件自带的模板描述新建时的表结构。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MuxError, ErrorCode } from './errors.js';

/**
 * @typedef {Object} BoardConfig
 * @property {string} base_token
 * @property {string} table_id
 * @property {Record<string,string>} fields  字段逻辑名 → 字段 ID
 * @property {string|null} [url]             多维表格链接
 */

/**
 * @typedef {Object} BoardTemplate
 * @property {string} base_name
 * @property {string} table_name
 * @property {Record<string,object>} fields  字段逻辑名 → lark-cli 字段定义（+field-create 的 JSON 格式）
 */

/** 用户配置路径：MUXBOARD_CONFIG 优先，默认 ~/.config/muxboard/board.json。 */
export function boardConfigPath(env = process.env) {
  return env.MUXBOARD_CONFIG || join(homedir(), '.config', 'muxboard', 'board.json');
}

/** @returns {BoardConfig|null} 文件不存在时返回 null */
export function readBoardConfig(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** @param {BoardConfig} config */
export function writeBoardConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

/** @returns {BoardTemplate} */
export function loadBoardTemplate() {
  const path = fileURLToPath(new URL('../config/board.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * 用户配置必须包含模板里的全部字段，缺了就报错并给出补法。纯本地比对，不调接口。
 * @param {BoardConfig} config
 * @param {BoardTemplate} template
 * @param {string} path 用户配置路径，写进提示里
 */
export function checkBoardConfig(config, template, path) {
  const missing = Object.keys(template.fields).filter((key) => !config.fields?.[key]);
  if (!missing.length) return;
  const list = missing.map((key) => `${key}（「${template.fields[key].name}」，类型 ${template.fields[key].type}）`).join('、');
  throw new MuxError(
    ErrorCode.BOARD_CONFIG_INCOMPLETE,
    `看板配置缺少字段：${list}。请在看板表中按插件模板 config/board.json 新建这些字段，再把字段 ID 写入 ${path} 的 fields.<逻辑名>`,
  );
}

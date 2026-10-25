// 看板配置：用户配置记录正在用的多维表格，插件自带的模板描述新建时的表结构。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

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

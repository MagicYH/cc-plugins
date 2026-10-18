#!/usr/bin/env bash
# 错误处理，用例见同目录 cases.md。
source "$(dirname "$0")/../lib.sh"

TITLE="e2e 错误 ${RUN_TAG}"
NOPE=recNOTEXIST000

mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过"
ROOT=$(j .data.task_id)

case_begin "E1 不在 botmux 会话里"
OUT=$(env -u BOTMUX_LARK_APP_ID "${MUXBOARD}" show "${ROOT}"); RC=$?
expect_err "show" "not_in_botmux"

case_begin "E2 不在普通群里创建根任务"
OUT=$(env -u BOTMUX_CHAT_ID BOTMUX_LARK_APP_ID="${E2E_APP_ID}" "${MUXBOARD}" init \
  --title "${TITLE}" --desc "端到端测试" --criteria "用例通过"); RC=$?
expect_err "缺少 BOTMUX_CHAT_ID" "not_in_botmux"
CHAT_TYPE=p2p mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过"
expect_err "单聊" "not_group_chat"

case_begin "E3 参数不合法"
mb nope
expect_err "未知命令" "invalid_args"
mb init --title t --desc d
expect_err "init 缺 --criteria" "invalid_args"
mb init --title t --desc d --criteria c --priority 极高
expect_err "非法优先级" "invalid_args"
mb init --title
expect_err "参数缺取值" "invalid_args"
mb assign "${ROOT}"
expect_err "assign 缺 --bot" "invalid_args"
mb output "${ROOT}"
expect_err "output 缺内容" "invalid_args"
mb split "${ROOT}"
expect_err "split 根任务" "invalid_args"

case_begin "E4 任务不存在"
mb show ${NOPE};                       expect_err "show" "not_found"
mb start ${NOPE};                      expect_err "start" "not_found"
mb children ${NOPE};                   expect_err "children" "not_found"
mb output ${NOPE} x;                   expect_err "output" "not_found"
mb status ${NOPE} 进行中;              expect_err "status" "not_found"
mb assign ${NOPE} --bot "${E2E_ASSIGNEE}"; expect_err "assign" "not_found"
mb add ${NOPE} --title t --desc d --criteria c; expect_err "add" "not_found"
mb split ${NOPE};                      expect_err "split" "not_found"

case_begin "E5 状态不合法"
mb status "${ROOT}" 待分配 --note x;   expect_err "status 待分配" "invalid_status"
mb status "${ROOT}" abc --note x;      expect_err "status abc" "invalid_status"
mb children "${ROOT}" --status abc;    expect_err "children --status abc" "invalid_status"

case_begin "E6 缺少说明"
mb status "${ROOT}" 阻塞;              expect_err "status 阻塞" "note_required"
mb status "${ROOT}" 已完成;            expect_err "status 已完成" "note_required"

case_begin "E7 分派没有父任务的任务"
mb assign "${ROOT}" --bot "${E2E_ASSIGNEE}"
expect_err "assign 根任务" "no_work_chat"

case_begin "E8 分派给不存在的 bot"
mb add "${ROOT}" --title "子任务" --desc "端到端测试" --criteria "用例通过"
CHILD=$(j .data.task_id)
mb assign "${CHILD}" --bot cli_notexist000
expect_err "assign" "bot_unresolved"
mb show "${CHILD}"
check "负责人没有被改" "$(j .data.owner)" "null"

summary

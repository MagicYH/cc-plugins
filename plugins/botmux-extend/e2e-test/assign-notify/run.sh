#!/usr/bin/env bash
# 分派与汇报，用例见同目录 cases.md。
source "$(dirname "$0")/../lib.sh"

TITLE="e2e 汇报 ${RUN_TAG}"

case_begin "A1 准备数据"
if [[ -n ${E2E_DISPATCHER} ]]; then
  mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过" --from "${E2E_DISPATCHER}"
else
  mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过"
fi
expect_ok "init"
ROOT=$(j .data.task_id)
mb add "${ROOT}" --title "子任务C" --desc "端到端测试" --criteria "用例通过"
expect_ok "add C"
C=$(j .data.task_id)
W=$(j .data.chat_id)
check "子任务在根群下" "${W}" "${E2E_SOURCE_CHAT}"
mb add "${ROOT}" --title "子任务D" --desc "端到端测试" --criteria "用例通过"
expect_ok "add D"
D=$(j .data.task_id)

case_begin "A2 分派子任务"
mb assign "${C}" --bot "${E2E_ASSIGNEE}"
expect_ok "assign"
check "返回负责人" "$(j .data.owner)" "${E2E_ASSIGNEE}"
check_match "返回消息 ID" "$(j .data.message_id)" '^om_'
mb show "${C}"
check "负责人" "$(j .data.owner)" "${E2E_ASSIGNEE}"
check "分派不改状态" "$(j .data.status)" "待分配"
check "分派消息" "$(chat_has "${W}" "你有一个新任务，任务 ID：${C}" mention)" "yes"

case_begin "A3 开始子任务"
mb start "${C}"
expect_ok "start"
check "状态" "$(j .data.status)" "进行中"
mb show "${C}"
check_match "当前进展" "$(j .data.progress)" '进行中：开始处理$'

case_begin "A4 二级拆分并分派"
mb split "${C}"
expect_ok "split C"
W2=$(j .data.chat_id)
mb add "${C}" --title "孙任务G" --desc "端到端测试" --criteria "用例通过"
expect_ok "add G"
G=$(j .data.task_id)
check "孙任务在 C 的工作群下" "$(j .data.chat_id)" "${W2}"
mb assign "${G}" --bot "${E2E_ASSIGNEE}"
expect_ok "assign G"
mb start "${G}"
expect_ok "start G"

case_begin "A5 有未完成下级时不能完成"
mb status "${C}" 已完成 --note "提前完成"
expect_err "status C 已完成" "children_unfinished"
mb show "${C}"
check "状态仍是进行中" "$(j .data.status)" "进行中"

case_begin "A6 孙任务完成，向 C 汇报"
mb status "${G}" 已完成 --note "孙任务通过"
expect_ok "status G 已完成"
check "已通知" "$(j .data.notified)" "true"
check "汇报消息" "$(chat_has "${W2}" "任务「孙任务G」（${G}）已完成：孙任务通过" mention)" "yes"

case_begin "A7 子任务完成，向根任务汇报"
mb status "${C}" 已完成 --note "子任务C通过"
expect_ok "status C 已完成"
check "已通知" "$(j .data.notified)" "true"
check "汇报消息" "$(chat_has "${W}" "任务「子任务C」（${C}）已完成：子任务C通过" mention)" "yes"

case_begin "A8 待分配的任务直接阻塞"
mb assign "${D}" --bot "${E2E_ASSIGNEE}"
expect_ok "assign D"
mb status "${D}" 阻塞 --note "缺少测试数据"
expect_ok "status D 阻塞"
check "已通知" "$(j .data.notified)" "true"
check "受阻消息" "$(chat_has "${W}" "任务「子任务D」（${D}）受阻：缺少测试数据" mention)" "yes"

case_begin "A9 阻塞后恢复并完成"
mb status "${D}" 进行中
expect_ok "status D 进行中"
check "恢复进行中不通知" "$(j .data.notified)" "false"
mb start "${D}"
check "start 不改状态" "$(j .data.status)" "进行中"
mb status "${D}" 已完成 --note "子任务D通过"
expect_ok "status D 已完成"
check "已通知" "$(j .data.notified)" "true"

case_begin "A10 根任务完成，在根群汇报"
mb status "${ROOT}" 已完成 --note "全部通过"
expect_ok "status 根任务 已完成"
check "已通知" "$(j .data.notified)" "true"
check "来源群汇报消息" "$(chat_has "${E2E_SOURCE_CHAT}" "任务「${TITLE}」（${ROOT}）已完成：全部通过")" "yes"
if [[ -n ${E2E_DISPATCHER} ]]; then
  check "汇报 @ 了派发人" "$(chat_has "${E2E_SOURCE_CHAT}" "（${ROOT}）已完成：全部通过" mention)" "yes"
else
  skip "未设置 E2E_DISPATCHER，不检查 @ 派发人"
fi

summary

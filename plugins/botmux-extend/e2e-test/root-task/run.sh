#!/usr/bin/env bash
# 根任务生命周期，用例见同目录 cases.md。
source "$(dirname "$0")/../lib.sh"

TITLE="e2e 根任务 ${RUN_TAG}"
PROGRESS_RE='^\[[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\] '

case_begin "R1 创建根任务并写入全部字段"
if [[ -n ${E2E_DISPATCHER} ]]; then
  mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过" --priority 高 --from "${E2E_DISPATCHER}"
else
  mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过" --priority 高
fi
expect_ok "init"
ROOT=$(j .data.task_id)
mb show "${ROOT}"
expect_ok "show"
check "负责人" "$(j .data.owner)" "${E2E_APP_ID}"
check "状态" "$(j .data.status)" "进行中"
check "优先级" "$(j .data.priority)" "高"
check "标题" "$(j .data.title)" "${TITLE}"
check_match "当前进展" "$(j .data.progress)" "${PROGRESS_RE}进行中：创建任务$"
check "没有父任务" "$(j .data.parent)" "null"
check "没有工作群" "$(j .data.work_chat)" "null"
check "子任务数" "$(j .data.children.total)" "0"
if [[ -n ${E2E_DISPATCHER} ]]; then
  check "派发人" "$(j .data.dispatcher.open_id)" "${E2E_DISPATCHER}"
else
  skip "未设置 E2E_DISPATCHER，不检查派发人"
fi

case_begin "R2 不传优先级和派发人"
mb init --title "${TITLE} 默认值" --desc "端到端测试" --criteria "用例通过"
expect_ok "init"
mb show "$(j .data.task_id)"
check "默认优先级" "$(j .data.priority)" "中"
check "派发人为空" "$(j .data.dispatcher)" "null"

case_begin "R3 派发人取会话发起人"
if [[ -n ${E2E_DISPATCHER} ]]; then
  OWNER=${E2E_DISPATCHER} mb init --title "${TITLE} 会话发起人" --desc "端到端测试" --criteria "用例通过"
  expect_ok "init"
  mb show "$(j .data.task_id)"
  check "派发人等于会话发起人" "$(j .data.dispatcher.open_id)" "${E2E_DISPATCHER}"
else
  skip "未设置 E2E_DISPATCHER"
fi

case_begin "R4 对进行中的任务执行 start"
mb start "${ROOT}"
expect_ok "start"
check "状态不变" "$(j .data.status)" "进行中"

case_begin "R5 根任务改为阻塞"
mb status "${ROOT}" 阻塞 --note "等待依赖"
expect_ok "status 阻塞"
check "没有工作群时不通知" "$(j .data.notified)" "false"
mb show "${ROOT}"
check "状态" "$(j .data.status)" "阻塞"
check_match "当前进展" "$(j .data.progress)" "${PROGRESS_RE}阻塞：等待依赖$"

case_begin "R6 对阻塞的任务执行 start"
mb start "${ROOT}"
expect_ok "start"
check "状态仍是阻塞" "$(j .data.status)" "阻塞"

case_begin "R7 阻塞后恢复进行中，不带说明"
mb status "${ROOT}" 进行中
expect_ok "status 进行中"
check "不通知" "$(j .data.notified)" "false"
mb show "${ROOT}"
check_match "当前进展" "$(j .data.progress)" "${PROGRESS_RE}进行中：继续处理$"

case_begin "R8 写入产出"
mb output "${ROOT}" "https://example.com/mr/1"
expect_ok "output"
mb show "${ROOT}"
check "产出" "$(j .data.output)" "https://example.com/mr/1"

case_begin "R9 没有子任务的根任务直接完成"
mb status "${ROOT}" 已完成 --note "全部完成"
expect_ok "status 已完成"
check "没有工作群时不通知" "$(j .data.notified)" "false"
mb show "${ROOT}"
check "状态" "$(j .data.status)" "已完成"

case_begin "R10 对已完成的任务执行 start"
mb start "${ROOT}"
expect_ok "start"
check "状态仍是已完成" "$(j .data.status)" "已完成"

summary

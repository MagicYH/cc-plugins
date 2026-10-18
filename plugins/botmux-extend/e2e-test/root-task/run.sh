#!/usr/bin/env bash
# 根任务生命周期，用例见同目录 cases.md。
source "$(dirname "$0")/../lib.sh"

TITLE="e2e 根任务 ${RUN_TAG}"
PROGRESS_RE='^\[[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\] '
SOURCE_NAME=$(chat_field "${E2E_SOURCE_CHAT}" name)

case_begin "R1 创建根任务并写入全部字段"
if [[ -n ${E2E_DISPATCHER} ]]; then
  mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过" --priority 高 --from "${E2E_DISPATCHER}"
else
  mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过" --priority 高
fi
expect_ok "init"
ROOT=$(j .data.task_id)
check "返回根群" "$(j .data.chat_id)" "${E2E_SOURCE_CHAT}"
mb show "${ROOT}"
expect_ok "show"
check "工作群是当前群" "$(j .data.work_chat.chat_id)" "${E2E_SOURCE_CHAT}"
check "负责人" "$(j .data.owner)" "${E2E_APP_ID}"
check "状态" "$(j .data.status)" "进行中"
check "优先级" "$(j .data.priority)" "高"
check "标题" "$(j .data.title)" "${TITLE}"
check_match "当前进展" "$(j .data.progress)" "${PROGRESS_RE}进行中：创建任务$"
check "没有父任务" "$(j .data.parent)" "null"
check "子任务数" "$(j .data.children.total)" "0"
check "根群的群名没有被改" "$(chat_field "${E2E_SOURCE_CHAT}" name)" "${SOURCE_NAME}"
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
check "已通知" "$(j .data.notified)" "true"
check "根群里有受阻消息" "$(chat_has "${E2E_SOURCE_CHAT}" "任务「${TITLE}」（${ROOT}）受阻：等待依赖")" "yes"
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
check "已通知" "$(j .data.notified)" "true"
check "根群里有完成消息" "$(chat_has "${E2E_SOURCE_CHAT}" "任务「${TITLE}」（${ROOT}）已完成：全部完成")" "yes"
if [[ -n ${E2E_DISPATCHER} ]]; then
  check "完成消息 @ 了派发人" "$(chat_has "${E2E_SOURCE_CHAT}" "（${ROOT}）已完成：全部完成" mention)" "yes"
fi
mb show "${ROOT}"
check "状态" "$(j .data.status)" "已完成"

case_begin "R10 对已完成的任务执行 start"
mb start "${ROOT}"
expect_ok "start"
check "状态仍是已完成" "$(j .data.status)" "已完成"

summary

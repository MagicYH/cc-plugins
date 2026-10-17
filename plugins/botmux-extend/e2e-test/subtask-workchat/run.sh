#!/usr/bin/env bash
# 子任务与工作群，用例见同目录 cases.md。
source "$(dirname "$0")/../lib.sh"

TITLE="e2e 工作群 ${RUN_TAG}"

case_begin "S1 根任务第一次建子任务"
mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过"
expect_ok "init"
ROOT=$(j .data.task_id)
mb add "${ROOT}" --title "子任务A" --desc "端到端测试" --criteria "用例通过"
expect_ok "add"
A=$(j .data.task_id)
W=$(j .data.chat_id)
check "新建了群" "$(j .data.chat_created)" "true"
mb show "${ROOT}"
check "根任务的工作群" "$(j .data.work_chat.chat_id)" "${W}"
check "群名" "$(chat_field "${W}" name)" "${TITLE}"
check "群描述" "$(chat_field "${W}" description)" "muxboard task=${ROOT} upper=${E2E_SOURCE_CHAT}"
check "说明消息" "$(chat_has "${W}" "本群是任务「${TITLE}」（${ROOT}）的工作群")" "yes"

case_begin "S2 再建一个子任务"
mb add "${ROOT}" --title "子任务B" --desc "端到端测试" --criteria "用例通过" --priority 低
expect_ok "add"
B=$(j .data.task_id)
check "没有新建群" "$(j .data.chat_created)" "false"
check "同一个群" "$(j .data.chat_id)" "${W}"

case_begin "S3 子任务的初始字段"
mb show "${A}"
check "状态" "$(j .data.status)" "待分配"
check "负责人为空" "$(j .data.owner)" "null"
check "父任务" "$(j .data.parent.task_id)" "${ROOT}"
check "默认优先级" "$(j .data.priority)" "中"
mb show "${B}"
check "指定优先级" "$(j .data.priority)" "低"

case_begin "S4 列出子任务"
mb children "${ROOT}"
expect_ok "children"
check "全部子任务" "$(j '.data.children | length')" "2"
mb children "${ROOT}" --status 待分配
check "待分配的子任务" "$(j '.data.children | length')" "2"
mb children "${ROOT}" --status 已完成
check "已完成的子任务" "$(j '.data.children | length')" "0"

case_begin "S5 子任务计数"
mb show "${ROOT}"
check "子任务总数" "$(j .data.children.total)" "2"
check "已完成数" "$(j .data.children.done)" "0"

case_begin "S6 二级拆分"
mb add "${A}" --title "孙任务A1" --desc "端到端测试" --criteria "用例通过"
expect_ok "add"
W2=$(j .data.chat_id)
check "新建了群" "$(j .data.chat_created)" "true"
check "群名" "$(chat_field "${W2}" name)" "${TITLE} - 子任务A"
check "群描述" "$(chat_field "${W2}" description)" "muxboard task=${A} upper=${W}"
check "说明消息" "$(chat_has "${W2}" "本群是任务「子任务A」（${A}）的工作群")" "yes"

case_begin "S7 上级群里的人被拉进新群"
SOURCE_USERS=$(chat_users "${E2E_SOURCE_CHAT}" | head -50)
if [[ -z ${SOURCE_USERS} ]]; then
  skip "来源群里没有人（只有 bot），无法验证"
else
  MISSING=$(comm -23 <(echo "${SOURCE_USERS}") <(chat_users "${W}"))
  check "来源群的人都在工作群里" "${MISSING:-无}" "无"
fi

summary

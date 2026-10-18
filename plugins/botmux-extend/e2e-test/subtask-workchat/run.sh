#!/usr/bin/env bash
# 子任务与工作群，用例见同目录 cases.md。
source "$(dirname "$0")/../lib.sh"

TITLE="e2e 工作群 ${RUN_TAG}"

case_begin "S1 在根任务下建子任务"
mb init --title "${TITLE}" --desc "端到端测试" --criteria "用例通过"
expect_ok "init"
ROOT=$(j .data.task_id)
mb add "${ROOT}" --title "子任务A" --desc "端到端测试" --criteria "用例通过"
expect_ok "add"
A=$(j .data.task_id)
check "子任务在根群下" "$(j .data.chat_id)" "${E2E_SOURCE_CHAT}"

case_begin "S2 再建一个子任务"
mb add "${ROOT}" --title "子任务B" --desc "端到端测试" --criteria "用例通过" --priority 低
expect_ok "add"
B=$(j .data.task_id)
check "仍在根群下" "$(j .data.chat_id)" "${E2E_SOURCE_CHAT}"

case_begin "S3 子任务的初始字段"
mb show "${A}"
check "状态" "$(j .data.status)" "待分配"
check "负责人为空" "$(j .data.owner)" "null"
check "父任务" "$(j .data.parent.task_id)" "${ROOT}"
check "没有工作群" "$(j .data.work_chat)" "null"
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

case_begin "S6 子任务未 split 就建下级"
mb add "${A}" --title "孙任务A1" --desc "端到端测试" --criteria "用例通过"
expect_err "add" "no_work_chat"

case_begin "S7 split 子任务"
mb split "${A}"
expect_ok "split"
W=$(j .data.chat_id)
check "新建了群" "$(j .data.chat_created)" "true"
mb show "${A}"
check "子任务A 的工作群" "$(j .data.work_chat.chat_id)" "${W}"
check "群名" "$(chat_field "${W}" name)" "${TITLE} - 子任务A"
check "群描述" "$(chat_field "${W}" description)" "muxboard task=${A} upper=${E2E_SOURCE_CHAT}"
check "说明消息" "$(chat_has "${W}" "本群是任务「子任务A」（${A}）的工作群")" "yes"

case_begin "S8 split 拉入上级群的 bot"
MISSING_BOTS=$(comm -23 <(chat_bots "${E2E_SOURCE_CHAT}") <(chat_bots "${W}"))
check "来源群的 bot 都在新群里" "${MISSING_BOTS:-无}" "无"

case_begin "S9 split 拉入上级群的人"
SOURCE_USERS=$(chat_users "${E2E_SOURCE_CHAT}" | head -50)
if [[ -z ${SOURCE_USERS} ]]; then
  skip "来源群里没有人（只有 bot），无法验证"
else
  MISSING_USERS=$(comm -23 <(echo "${SOURCE_USERS}") <(chat_users "${W}"))
  check "来源群的人都在新群里" "${MISSING_USERS:-无}" "无"
fi

case_begin "S10 重复 split"
mb split "${A}"
expect_ok "split"
check "没有新建群" "$(j .data.chat_created)" "false"
check "同一个群" "$(j .data.chat_id)" "${W}"

case_begin "S11 split 后建下级"
mb add "${A}" --title "孙任务A1" --desc "端到端测试" --criteria "用例通过"
expect_ok "add"
check "孙任务在新群下" "$(j .data.chat_id)" "${W}"

summary

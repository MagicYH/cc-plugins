#!/usr/bin/env bash
# 端到端测试的公共函数，由各功能目录的 run.sh 用 source 引入。
# 真实调用飞书：会在看板里新建记录、新建工作群，测试数据不清理。

set -u

E2E_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MUXBOARD="${E2E_DIR}/../bin/muxboard"

: "${E2E_APP_ID:?需要设置 E2E_APP_ID：执行测试的 bot 的 app_id，必须与 lark-cli 当前配置的应用一致}"
: "${E2E_SOURCE_CHAT:?需要设置 E2E_SOURCE_CHAT：当作来源群的群 ID，执行测试的 bot 必须在群里}"
# 分派目标默认是执行测试的 bot 自己，避免唤醒其他 bot 去执行测试任务
E2E_ASSIGNEE=${E2E_ASSIGNEE:-${E2E_APP_ID}}
# 派发人 open_id（属于 E2E_APP_ID 的应用）；不设置时跳过派发人相关的检查
E2E_DISPATCHER=${E2E_DISPATCHER:-}
RUN_TAG=${RUN_TAG:-$(date +%m%d-%H%M%S)}

PASS=0
FAIL=0
SKIP=0

# 在临时目录里执行，避免在代码仓库里留下文件
WORKDIR=$(mktemp -d)
cd "${WORKDIR}" || exit 1
trap 'rm -rf "${WORKDIR}"' EXIT

# mb <参数...>：模拟 botmux 会话运行 muxboard，输出存到 OUT，退出码存到 RC。
# 当前群默认是来源群，用 CHAT=<oc_x> mb ... 覆盖；会话类型默认 group，用 CHAT_TYPE=p2p mb ... 覆盖；
# 会话发起人用 OWNER=<ou_x> mb ... 设置。
mb() {
  OUT=$(BOTMUX_LARK_APP_ID="${E2E_APP_ID}" BOTMUX_CHAT_ID="${CHAT:-${E2E_SOURCE_CHAT}}" \
    BOTMUX_CHAT_TYPE="${CHAT_TYPE:-group}" BOTMUX_OWNER_OPEN_ID="${OWNER:-}" "${MUXBOARD}" "$@")
  RC=$?
}

# j <jq 表达式>：从上一次 mb 的输出里取值
j() { jq -r "$1" <<<"${OUT}"; }

case_begin() { echo "▶ $1"; }

_report() {
  if [[ $1 == ok ]]; then
    PASS=$((PASS + 1)); echo "  ✔ $2"
  else
    FAIL=$((FAIL + 1)); echo "  ✘ $2：$3"
    echo "    最近一次输出：$(tr -d '\n' <<<"${OUT:-}" | cut -c1-300)"
  fi
}

# check <说明> <实际> <预期>
check() {
  if [[ "$2" == "$3" ]]; then _report ok "$1"; else _report fail "$1" "期望 [$3]，实际 [$2]"; fi
}

# check_match <说明> <实际> <正则>
check_match() {
  if [[ "$2" =~ $3 ]]; then _report ok "$1"; else _report fail "$1" "[$2] 不匹配 /$3/"; fi
}

skip() { SKIP=$((SKIP + 1)); echo "  - 跳过：$1"; }

expect_ok() { check "$1：成功" "${RC}/$(j .ok)" "0/true"; }
expect_err() { check "$1：返回 $2" "${RC}/$(j .error.code)" "1/$2"; }

# 以下直接调用 lark-cli 读飞书，用来核对 muxboard 的副作用
lark() { lark-cli "$@" --as bot; }

# chat_field <chat_id> <字段>：读群信息，如 name、description
chat_field() { lark im chats get --chat-id "$1" 2>/dev/null | jq -r ".data.$2 // empty"; }

# chat_users <chat_id>：群里的人（不含 bot），open_id 排序后每行一个
chat_users() {
  lark im +chat-members-list --chat-id "$1" --page-all 2>/dev/null | jq -r '.data.users[]?.member_id' | sort
}

# chat_bots <chat_id>：群里的 bot，app_id 排序后每行一个
chat_bots() {
  lark im +chat-members-list --chat-id "$1" --page-all 2>/dev/null | jq -r '.data.bots[]?.app_id' | sort
}

# chat_has <chat_id> <子串> [mention]：群里最近的消息中有包含子串的消息则输出 yes。
# 第三个参数为 mention 时，还要求这条消息 @ 了人。飞书消息列表有延迟，最多重试 5 次。
chat_has() {
  # $s 是 jq 变量（由 --arg 传入），不是 shell 变量
  local filter='.data.messages[]? | select(.content | contains($s))'
  [[ ${3:-} == mention ]] && filter+=' | select((.mentions // []) | length > 0)'
  for _ in 1 2 3 4 5; do
    if lark im +chat-messages-list --chat-id "$1" 2>/dev/null | jq -e --arg s "$2" "${filter}" >/dev/null; then
      echo yes; return
    fi
    sleep 2
  done
  echo no
}

summary() {
  echo
  echo "结果：通过 ${PASS}，失败 ${FAIL}，跳过 ${SKIP}"
  [[ ${FAIL} -eq 0 ]]
}

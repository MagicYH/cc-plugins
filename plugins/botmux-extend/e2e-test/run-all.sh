#!/usr/bin/env bash
# 依次运行所有功能目录的端到端测试；任一目录失败时退出码非 0。
# 用法：e2e-test/run-all.sh [目录名...]，不传时运行全部。

E2E_DIR=$(cd "$(dirname "$0")" && pwd)
SUITES=("$@")
[[ ${#SUITES[@]} -eq 0 ]] && SUITES=(root-task subtask-workchat assign-notify errors)

export RUN_TAG=${RUN_TAG:-$(date +%m%d-%H%M%S)}
FAILED=()
for suite in "${SUITES[@]}"; do
  echo "===== ${suite} ====="
  bash "${E2E_DIR}/${suite}/run.sh" || FAILED+=("${suite}")
  echo
done

if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "全部通过：${SUITES[*]}"
else
  echo "失败的目录：${FAILED[*]}"
  exit 1
fi

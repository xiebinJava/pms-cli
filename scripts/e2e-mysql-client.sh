#!/usr/bin/env bash
set -euo pipefail

# The audit helper invokes PMS_E2E_MYSQL_CLIENT with normal mysql-client
# arguments. Strip the host-published connection options and run the query
# through the MySQL client bundled in the disposable database container.
container="${PMS_E2E_MYSQL_CONTAINER:-}"
if [[ -z "$container" ]]; then
  : "${PMS_E2E_RUN_ID:?PMS_E2E_RUN_ID is required when PMS_E2E_MYSQL_CONTAINER is omitted}"
  container="pms-ai-e2e-${PMS_E2E_RUN_ID}-mysql-1"
fi

mysql_args=()
while (($#)); do
  case "$1" in
    --host|--port)
      if (($# < 2)); then
        echo "missing value for $1" >&2
        exit 2
      fi
      shift 2
      ;;
    *)
      mysql_args+=("$1")
      shift
      ;;
  esac
done

exec docker exec \
  -e "MYSQL_PWD=${MYSQL_PWD:-}" \
  "$container" \
  mysql --host 127.0.0.1 --port 3306 "${mysql_args[@]}"

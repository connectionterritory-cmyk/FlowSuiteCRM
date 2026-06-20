#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-flowsuitecrm}"
ACTION="${2:-status}"
shift $(( $# > 0 ? 1 : 0 )) || true
shift $(( $# > 0 ? 1 : 0 )) || true

case "$TARGET" in
  root)
    PROJECT_DIR="$ROOT_DIR"
    ;;
  flowsuitecrm)
    PROJECT_DIR="$ROOT_DIR/flowsuitecrm"
    ;;
  *)
    echo "Uso: $0 [flowsuitecrm|root] [status|migration-list|db-push|start|stop|link|functions-list] [args...]"
    exit 1
    ;;
esac

run_supabase() {
  (cd "$PROJECT_DIR" && supabase "$@")
}

case "$ACTION" in
  status)
    run_supabase status
    ;;
  migration-list)
    run_supabase migration list
    ;;
  db-push)
    run_supabase db push "$@"
    ;;
  start)
    run_supabase start "$@"
    ;;
  stop)
    run_supabase stop
    ;;
  link)
    run_supabase link "$@"
    ;;
  functions-list)
    run_supabase functions list "$@"
    ;;
  *)
    echo "Acción no soportada: $ACTION"
    echo "Acciones: status, migration-list, db-push, start, stop, link, functions-list"
    exit 1
    ;;
esac

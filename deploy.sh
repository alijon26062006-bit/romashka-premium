#!/usr/bin/env bash
# ============================================================
#  Ромашка Premium — запуск на сервере одной командой
#
#  С доменом:   ./deploy.sh romashka.tj
#  Без домена:  ./deploy.sh            (сайт откроется по IP сервера)
#
#  Скрипт сам поставит Docker, создаст .env со случайным паролем,
#  соберёт проект и получит бесплатный SSL-сертификат.
# ============================================================

set -euo pipefail

DOMAIN_ARG="${1:-}"
cd "$(dirname "$0")"

log()  { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m  %s\033[0m\n' "$1"; }

# ------------------------------------------------------------------ Docker
log "Проверяю Docker"
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker не найден — устанавливаю (займёт 1-2 минуты)"
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Нужен Docker Compose v2. Обновите Docker и запустите скрипт снова." >&2
  exit 1
fi

# ------------------------------------------------------------------ .env
log "Готовлю настройки"
NEW_PASSWORD=""

if [ ! -f .env ]; then
  cp .env.example .env
  NEW_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${NEW_PASSWORD}|" .env
  warn "Создан файл .env со случайным паролем администратора"
else
  warn "Файл .env уже есть — оставляю как есть"
fi

if [ -n "$DOMAIN_ARG" ]; then
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN_ARG}|" .env
  sed -i "s|^SITE_URL=.*|SITE_URL=https://${DOMAIN_ARG}|" .env
  warn "Домен: ${DOMAIN_ARG} (SSL-сертификат Caddy получит автоматически)"
fi

mkdir -p data uploads

# ------------------------------------------------------------------ Запуск
log "Собираю и запускаю проект"
docker compose up -d --build

log "Проверяю, что сервер отвечает"
for i in $(seq 1 30); do
  if docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ------------------------------------------------------------------ Итог
ADMIN_USER_VALUE="$(grep -E '^ADMIN_USER=' .env | cut -d= -f2-)"
ADMIN_PASS_VALUE="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
SITE="${DOMAIN_ARG:+https://$DOMAIN_ARG}"
SITE="${SITE:-http://$(hostname -I 2>/dev/null | awk '{print $1}')}"

printf '\n\033[1;32m==========================================\033[0m\n'
printf '  🌼 Магазин запущен\n'
printf '  Сайт:    %s\n' "$SITE"
printf '  Админка: %s/admin.html\n' "$SITE/admin.html"
printf '  Логин:   %s\n' "$ADMIN_USER_VALUE"
printf '  Пароль:  %s\n' "$ADMIN_PASS_VALUE"
printf '\033[1;32m==========================================\033[0m\n\n'
printf '  Логи:       docker compose logs -f\n'
printf '  Обновить:   git pull && ./deploy.sh %s\n' "$DOMAIN_ARG"
printf '  Остановить: docker compose down\n\n'

if [ -n "$NEW_PASSWORD" ]; then
  warn "Сохраните пароль! Он также лежит в файле .env"
fi

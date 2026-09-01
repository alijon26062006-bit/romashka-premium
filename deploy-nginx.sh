#!/usr/bin/env bash
# ============================================================
#  Ромашка Premium — установка на сервер, где уже работает nginx
#
#  Используйте этот скрипт, если порты 80 и 443 заняты другим сайтом.
#  Caddy не ставится. Магазин слушает только localhost, а nginx
#  проксирует на него запросы вашего домена. Существующие сайты
#  не затрагиваются — добавляется отдельный server-блок.
#
#  Запуск:  ./deploy-nginx.sh raycvetov.duckdns.org
# ============================================================

set -euo pipefail

DOMAIN="${1:-}"
cd "$(dirname "$0")"

log()  { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m  %s\033[0m\n' "$1"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n\n' "$1" >&2; exit 1; }

if [ -z "$DOMAIN" ]; then
  die "Укажите домен. Пример: ./deploy-nginx.sh raycvetov.duckdns.org"
fi

# ------------------------------------------------------------------ Права
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
    warn "Запущено не от root — используется sudo, может спросить пароль"
  else
    die "Запустите скрипт от root или установите sudo."
  fi
fi

# ------------------------------------------------------------------ Проверки
log "Проверяю окружение"

if ! command -v nginx >/dev/null 2>&1; then
  die "nginx не найден. Для чистого сервера используйте обычный ./deploy.sh — он поставит Caddy сам."
fi
warn "nginx найден: $(nginx -v 2>&1)"

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker не найден — устанавливаю (займёт 1-2 минуты)"
  curl -fsSL https://get.docker.com | $SUDO sh
fi

if ! $SUDO docker compose version >/dev/null 2>&1; then
  die "Нужен Docker Compose v2. Обновите Docker и запустите скрипт снова."
fi

# Свободный порт для приложения: если 3000 занят, берём следующий
APP_PORT=3000
while ss -ltn 2>/dev/null | grep -q ":${APP_PORT} " || netstat -ltn 2>/dev/null | grep -q ":${APP_PORT} "; do
  APP_PORT=$((APP_PORT + 1))
  [ "$APP_PORT" -gt 3050 ] && die "Не нашёл свободный порт в диапазоне 3000-3050"
done
warn "Приложение займёт localhost:${APP_PORT}"

# ------------------------------------------------------------------ .env
log "Готовлю настройки"
NEW_PASSWORD=""

if [ ! -f .env ]; then
  cp .env.example .env
  NEW_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${NEW_PASSWORD}|" .env
  warn "Создан .env со случайным паролем администратора"
else
  warn ".env уже есть — пароль оставляю прежним"
fi

sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env
sed -i "s|^SITE_URL=.*|SITE_URL=https://${DOMAIN}|" .env

if grep -qE '^APP_PORT=' .env; then
  sed -i "s|^APP_PORT=.*|APP_PORT=${APP_PORT}|" .env
else
  printf '\nAPP_PORT=%s\n' "$APP_PORT" >> .env
fi

mkdir -p data uploads

# ------------------------------------------------------------------ Запуск
PROFILE_ARGS=""
if grep -qE '^DUCKDNS_TOKEN=.+' .env; then
  PROFILE_ARGS="--profile duckdns"
  warn "DuckDNS: включено автообновление IP"
fi

log "Собираю и запускаю магазин"
# --remove-orphans убирает контейнер caddy, если раньше запускали обычный deploy.sh
$SUDO docker compose -f docker-compose.nginx.yml $PROFILE_ARGS up -d --build --remove-orphans

log "Жду ответа приложения"
SERVER_UP=0
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    SERVER_UP=1
    break
  fi
  sleep 2
done

if [ "$SERVER_UP" -ne 1 ]; then
  warn "Приложение не ответило. Логи:"
  $SUDO docker compose -f docker-compose.nginx.yml logs --tail 40 web || true
  die "Останавливаюсь, nginx не трогаю."
fi
warn "Приложение отвечает на localhost:${APP_PORT}"

# ------------------------------------------------------------------ nginx
log "Настраиваю nginx"

if [ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ]; then
  CONF_PATH="/etc/nginx/sites-available/${DOMAIN}"
  LINK_PATH="/etc/nginx/sites-enabled/${DOMAIN}"
else
  CONF_PATH="/etc/nginx/conf.d/${DOMAIN}.conf"
  LINK_PATH=""
fi

# Домен может быть уже занят другим сайтом — например, certbot умеет
# дописать server_name в чужой блок. Два блока с одним именем nginx
# примет молча, но обслуживать домен будет первый, и магазин не появится.
CONFLICT_FILE="$(
  $SUDO grep -rlE "server_name[^;]*(^|[[:space:]])${DOMAIN}([[:space:];]|$)" /etc/nginx/ 2>/dev/null \
    | grep -vx "$CONF_PATH" | grep -vx "$LINK_PATH" | head -n 1 || true
)"

if [ -n "$CONFLICT_FILE" ]; then
  printf '\n\033[1;31m✖ Домен уже обслуживается другим сайтом\033[0m\n\n'
  printf '  Файл: %s\n\n' "$CONFLICT_FILE"
  printf '  Строки с вашим доменом:\n'
  $SUDO grep -nE "server_name[^;]*${DOMAIN}" "$CONFLICT_FILE" | sed 's/^/    /'
  printf '\n  Что сделать: уберите %s из server_name в этом файле,\n' "$DOMAIN"
  printf '  сохраните и запустите скрипт снова:\n\n'
  printf '    %s nano %s\n' "$SUDO" "$CONFLICT_FILE"
  printf '    %s nginx -t && %s systemctl reload nginx\n' "$SUDO" "$SUDO"
  printf '    ./deploy-nginx.sh %s\n\n' "$DOMAIN"
  printf '  Чужой конфиг я не редактирую — это ваш работающий сайт.\n\n'
  exit 1
fi

# Старый конфиг сохраняем, чтобы можно было вернуться
if [ -f "$CONF_PATH" ]; then
  BACKUP="${CONF_PATH}.backup-$(date +%Y%m%d-%H%M%S)"
  $SUDO cp "$CONF_PATH" "$BACKUP"
  warn "Прежний конфиг сохранён: $BACKUP"
fi

# Если сертификат для домена уже получен, сразу пишем конфиг с HTTPS —
# так certbot не станет второй раз править чужие файлы.
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
HAS_CERT=0
if $SUDO test -f "${CERT_DIR}/fullchain.pem"; then
  HAS_CERT=1
  warn "Найден готовый сертификат: ${CERT_DIR}"
fi

# Кавычки у NGINXPROXY обязательны: иначе bash съест $host и $remote_addr
PROXY_BLOCK="$(cat <<'NGINXPROXY'
    # Фотографии букетов до 8 МБ. Без этой строки nginx вернёт 413
    # и загрузка фото в админке молча перестанет работать.
    client_max_body_size 10M;

    access_log /var/log/nginx/__DOMAIN__.access.log;
    error_log  /var/log/nginx/__DOMAIN__.error.log;

    location / {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
NGINXPROXY
)"

HEADER="# Ромашка Premium — проксирование на приложение в Docker.
# Файл создан скриптом deploy-nginx.sh, правки при повторном запуске перезапишутся."

if [ "$HAS_CERT" -eq 1 ]; then
  SSL_OPTIONS=""
  if $SUDO test -f /etc/letsencrypt/options-ssl-nginx.conf; then
    SSL_OPTIONS="    include /etc/letsencrypt/options-ssl-nginx.conf;"
  fi

  CONFIG_TEXT="${HEADER}

server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name __DOMAIN__;

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
${SSL_OPTIONS}

${PROXY_BLOCK}
}"
else
  CONFIG_TEXT="${HEADER}

server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

${PROXY_BLOCK}
}"
fi

printf '%s\n' "$CONFIG_TEXT" \
  | sed -e "s|__DOMAIN__|${DOMAIN}|g" -e "s|__PORT__|${APP_PORT}|g" \
  | $SUDO tee "$CONF_PATH" >/dev/null

if [ -n "$LINK_PATH" ] && [ ! -e "$LINK_PATH" ]; then
  $SUDO ln -s "$CONF_PATH" "$LINK_PATH"
fi

log "Проверяю конфигурацию nginx"
if ! $SUDO nginx -t; then
  $SUDO rm -f "$LINK_PATH" 2>/dev/null || true
  die "Конфиг nginx не прошёл проверку — изменения откатаны, существующие сайты не задеты."
fi

$SUDO systemctl reload nginx 2>/dev/null || $SUDO nginx -s reload
warn "nginx перезагружен, другие сайты не тронуты"

# ------------------------------------------------------------------ SSL
log "Проверяю SSL"

if [ "$HAS_CERT" -eq 1 ]; then
  warn "Сертификат уже был получен и подключён — certbot не запускаю"
  SCHEME="https"
elif command -v certbot >/dev/null 2>&1; then
  ACME_EMAIL_VALUE="$(grep -E '^ACME_EMAIL=' .env | cut -d= -f2- || true)"
  if [ -n "$ACME_EMAIL_VALUE" ]; then
    EMAIL_ARGS="-m ${ACME_EMAIL_VALUE}"
  else
    EMAIL_ARGS="--register-unsafely-without-email"
  fi

  if $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect $EMAIL_ARGS; then
    warn "Сертификат установлен, HTTPS включён"
    SCHEME="https"
  else
    warn "Certbot не смог выдать сертификат. Сайт работает по HTTP."
    warn "Частая причина: домен указывает на другой сервер или порт 80 закрыт извне."
    SCHEME="http"
  fi
else
  warn "certbot не установлен — сайт пока работает по HTTP."
  warn "Установить: $SUDO apt install -y certbot python3-certbot-nginx"
  warn "Затем:      $SUDO certbot --nginx -d ${DOMAIN}"
  SCHEME="http"
fi

# ------------------------------------------------------------------ Итог
ADMIN_USER_VALUE="$(grep -E '^ADMIN_USER=' .env | cut -d= -f2-)"
ADMIN_PASS_VALUE="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"

printf '\n\033[1;32m==========================================\033[0m\n'
printf '  🌼 Магазин запущен рядом с существующим сайтом\n'
printf '  Сайт:    %s://%s\n' "$SCHEME" "$DOMAIN"
printf '  Админка: %s://%s/admin.html\n' "$SCHEME" "$DOMAIN"
printf '  Логин:   %s\n' "$ADMIN_USER_VALUE"
printf '  Пароль:  %s\n' "$ADMIN_PASS_VALUE"
printf '\033[1;32m==========================================\033[0m\n\n'
printf '  Логи магазина: %s docker compose -f docker-compose.nginx.yml logs -f\n' "$SUDO"
printf '  Обновить:      git pull && ./deploy-nginx.sh %s\n' "$DOMAIN"
printf '  Остановить:    %s docker compose -f docker-compose.nginx.yml down\n' "$SUDO"
printf '  Конфиг nginx:  %s\n\n' "$CONF_PATH"

if [ -n "$NEW_PASSWORD" ]; then
  warn "Сохраните пароль! Он также лежит в файле .env"
fi

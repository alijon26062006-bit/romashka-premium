/* ==========================================================================
   Ромашка Premium — счётчик посещаемости

   Считаем только просмотры страниц людьми: главная и карточка товара.
   Запросы к API, картинки и служебные файлы не учитываются — иначе один
   заход выглядел бы как двадцать.

   IP посетителя нигде не хранится. От него берётся необратимый отпечаток
   (SHA-256 от IP, браузера, даты и случайной соли этой установки), причём
   только первые 16 символов. Он нужен ровно для одного: понять, что два
   просмотра за день сделал один человек. На следующий день отпечаток того
   же посетителя уже другой.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { DATA_DIR, readJson, writeJson } = require('./store');

const STATS_FILE = path.join(DATA_DIR, 'stats.json');

/* Часовой пояс магазина: без него «сегодня» в контейнере начиналось бы
   в 5 утра по Душанбе, и вечерняя выручка попадала бы во «вчера». */
const SHOP_TZ = process.env.SHOP_TZ || 'Asia/Dushanbe';

const KEEP_DAYS = 90;          // сколько дней истории держим
const MAX_VISITORS_PER_DAY = 20000;  // предел размера файла на случай наплыва
const FLUSH_MS = 30 * 1000;    // как часто скидываем на диск

const emptyStats = {
  since: new Date().toISOString(),
  salt: crypto.randomBytes(16).toString('hex'),
  totalViews: 0,
  days: {},
  products: {}
};

let state = load();
let dirty = false;

function load() {
  const raw = readJson(STATS_FILE, emptyStats);
  return {
    since: raw.since || emptyStats.since,
    salt: raw.salt || emptyStats.salt,
    totalViews: Number(raw.totalViews) || 0,
    days: raw.days && typeof raw.days === 'object' ? raw.days : {},
    products: raw.products && typeof raw.products === 'object' ? raw.products : {}
  };
}

/* Дата в виде 2026-09-01 в часовом поясе магазина.
   Локаль en-CA выбрана потому, что она даёт ровно такой формат. */
function today(date) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: SHOP_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date || new Date());
  } catch {
    return (date || new Date()).toISOString().slice(0, 10);
  }
}

function shiftDay(days) {
  return today(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function dayEntry(key) {
  if (!state.days[key]) state.days[key] = { views: 0, visitors: [] };
  const entry = state.days[key];
  if (!Array.isArray(entry.visitors)) entry.visitors = [];
  return entry;
}

function fingerprint(req, day) {
  const ip = req.ip || 'unknown';
  const agent = String(req.headers['user-agent'] || '');
  return crypto
    .createHash('sha256')
    .update(ip + '|' + agent + '|' + day + '|' + state.salt)
    .digest('hex')
    .slice(0, 16);
}

/* Отсекаем поисковых роботов: они не покупатели, а в статистике шумят сильно. */
const BOT_AGENT = /bot|crawler|spider|crawling|preview|monitor|curl|wget|headless|facebookexternalhit|whatsapp|telegram/i;

function isBot(req) {
  const agent = String(req.headers['user-agent'] || '');
  if (!agent) return true;
  return BOT_AGENT.test(agent);
}

function track(req, productId) {
  if (isBot(req)) return;

  const day = today();
  const entry = dayEntry(day);

  entry.views += 1;
  state.totalViews += 1;

  const mark = fingerprint(req, day);
  if (!entry.visitors.includes(mark) && entry.visitors.length < MAX_VISITORS_PER_DAY) {
    entry.visitors.push(mark);
  }

  if (productId) {
    const key = String(productId);
    state.products[key] = (Number(state.products[key]) || 0) + 1;
  }

  dirty = true;
}

function prune() {
  const limit = shiftDay(KEEP_DAYS);
  Object.keys(state.days).forEach(day => {
    if (day < limit) delete state.days[day];
  });
}

function flush() {
  if (!dirty) return;
  prune();
  try {
    writeJson(STATS_FILE, state);
    dirty = false;
  } catch (e) {
    console.error('Статистика: не удалось сохранить —', e.message);
  }
}

/* Просмотры пишутся в память, а на диск уходят раз в полминуты:
   на каждом заходе на сайт трогать диск незачем. */
const timer = setInterval(flush, FLUSH_MS);
timer.unref();

function range(days) {
  let views = 0;
  const people = new Set();

  for (let i = 0; i < days; i++) {
    const entry = state.days[shiftDay(i)];
    if (!entry) continue;
    views += Number(entry.views) || 0;
    (entry.visitors || []).forEach(v => people.add(v));
  }

  return { views, visitors: people.size };
}

function dayStats(key) {
  const entry = state.days[key];
  if (!entry) return { views: 0, visitors: 0 };
  return { views: Number(entry.views) || 0, visitors: (entry.visitors || []).length };
}

/* Готовая сводка для телеграм-бота и админки. */
function summary(products) {
  const list = Array.isArray(products) ? products : [];

  const top = Object.entries(state.products)
    .map(([id, views]) => {
      const product = list.find(p => String(p.id) === String(id));
      return { id, views: Number(views) || 0, name: product ? product.name : 'удалённый товар' };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  return {
    since: state.since,
    timezone: SHOP_TZ,
    today: dayStats(today()),
    yesterday: dayStats(shiftDay(1)),
    week: range(7),
    month: range(30),
    totalViews: state.totalViews,
    top
  };
}

module.exports = { track, flush, summary, today, STATS_FILE };

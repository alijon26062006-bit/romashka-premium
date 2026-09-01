/* ==========================================================================
   Ромашка Premium — хранилище магазина
   Каталог, настройки и заявки лежат в JSON-файлах в data/, фотографии в uploads/.
   Модуль общий: с ним работают и веб-сервер, и телеграм-бот, поэтому правила
   очистки данных и удаления файлов у них одни и те же.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

/* Обычно данные лежат рядом с кодом. Переопределение нужно тестам, чтобы они
   работали в своей папке и не трогали настоящий каталог магазина. */
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(ROOT, 'uploads');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const MAX_ORDERS = 500;
const MAX_IMAGES = 5;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* --------------------------------------------------------------------------
   Данные по умолчанию
   -------------------------------------------------------------------------- */

const defaultSettings = {
  shopName: 'Ромашка',
  tagline: 'цветочный магазин',
  whatsapp: '992901403263',
  phone: '+992 90 140 32 63',
  hours: 'Ежедневно 08:00–22:00',
  city: 'Душанбе',
  address: '',
  instagram: '',
  telegram: '',
  deliveryNote: 'Доставка по Душанбе',
  freshNote: 'Свежие цветы каждый день',
  currency: 'сомони',
  metaDescription: 'Ромашка — цветочный магазин в Душанбе. Свежие букеты, композиции и доставка.',
  /* Коды из Google Search Console и Яндекс.Вебмастера — ими сайт
     подтверждает, что он ваш, и попадает в поиск быстрее. */
  googleVerification: '',
  yandexVerification: ''
};

const defaultProducts = [
  {
    id: 1,
    name: 'Нежная ромашка',
    category: 'Ромашки',
    price: 120,
    oldPrice: 0,
    description: 'Воздушный букет из свежих ромашек. Лёгкий, тёплый и очень нежный подарок для близкого человека.',
    composition: 'Ромашки, декоративная зелень, упаковка',
    size: 'Средний',
    colors: ['Белый'],
    occasions: ['Без повода', 'День рождения'],
    image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?auto=format&fit=crop&w=1200&q=88',
    images: ['https://images.unsplash.com/photo-1597848212624-a19eb35e2651?auto=format&fit=crop&w=1200&q=88'],
    available: true,
    featured: true,
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 2,
    name: 'Розовая мечта',
    category: 'Розы',
    price: 280,
    oldPrice: 0,
    description: 'Элегантная композиция из нежно-розовых роз для романтичного и красивого подарка.',
    composition: 'Розовые розы, зелень, дизайнерская упаковка',
    size: 'Средний',
    colors: ['Розовый'],
    occasions: ['Романтика', 'Годовщина'],
    image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1200&q=88',
    images: ['https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1200&q=88'],
    available: true,
    featured: true,
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 3,
    name: 'Белая классика',
    category: 'Букеты',
    price: 240,
    oldPrice: 0,
    description: 'Минималистичный светлый букет, который подойдёт для дня рождения, встречи или важного события.',
    composition: 'Белые цветы, эвкалипт, зелень',
    size: 'Средний',
    colors: ['Белый'],
    occasions: ['День рождения'],
    image: 'https://images.unsplash.com/photo-1523438885200-e635ba2c371e?auto=format&fit=crop&w=1200&q=88',
    images: ['https://images.unsplash.com/photo-1523438885200-e635ba2c371e?auto=format&fit=crop&w=1200&q=88'],
    available: true,
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 4,
    name: 'Весенний сад',
    category: 'Букеты',
    price: 320,
    oldPrice: 0,
    description: 'Яркая сезонная композиция с живой зеленью и лёгким весенним настроением.',
    composition: 'Сезонные цветы, зелень, лента',
    size: 'Большой',
    colors: ['Разноцветный'],
    occasions: ['8 марта', 'День рождения'],
    image: 'https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=1200&q=88',
    images: ['https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=1200&q=88'],
    available: true,
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 5,
    name: 'Любовь',
    category: 'Розы',
    price: 450,
    oldPrice: 0,
    description: 'Большой букет красных роз — классический романтический подарок для особенного человека.',
    composition: 'Красные розы, зелень, премиальная упаковка',
    size: 'Большой',
    colors: ['Красный'],
    occasions: ['Романтика', '14 февраля'],
    image: 'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?auto=format&fit=crop&w=1200&q=88',
    images: ['https://images.unsplash.com/photo-1518895949257-7621c3c786d7?auto=format&fit=crop&w=1200&q=88'],
    available: true,
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 6,
    name: 'Лавандовое утро',
    category: 'Композиции',
    price: 210,
    oldPrice: 0,
    description: 'Спокойная композиция в натуральных оттенках. Идеальна для уютного подарка без повода.',
    composition: 'Лаванда, сухоцветы, декоративная зелень',
    size: 'Небольшой',
    colors: ['Фиолетовый'],
    occasions: ['Без повода'],
    image: 'https://images.unsplash.com/photo-1495231916356-a86217efff12?auto=format&fit=crop&w=1200&q=88',
    images: ['https://images.unsplash.com/photo-1495231916356-a86217efff12?auto=format&fit=crop&w=1200&q=88'],
    available: true,
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

/* --------------------------------------------------------------------------
   Чтение и запись JSON (запись атомарная: временный файл + rename)
   -------------------------------------------------------------------------- */

function writeJson(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(fallback) && !Array.isArray(parsed)) throw new Error('bad shape');
    return parsed;
  } catch {
    writeJson(file, fallback);
    return JSON.parse(JSON.stringify(fallback));
  }
}

if (!fs.existsSync(PRODUCTS_FILE)) writeJson(PRODUCTS_FILE, defaultProducts);
if (!fs.existsSync(SETTINGS_FILE)) writeJson(SETTINGS_FILE, defaultSettings);
if (!fs.existsSync(ORDERS_FILE)) writeJson(ORDERS_FILE, []);

function readProducts() {
  return readJson(PRODUCTS_FILE, defaultProducts).map(normalizeProduct);
}

function writeProducts(products) {
  writeJson(PRODUCTS_FILE, products);
}

function readSettings() {
  return Object.assign({}, defaultSettings, readJson(SETTINGS_FILE, defaultSettings));
}

function writeSettings(settings) {
  writeJson(SETTINGS_FILE, settings);
}

function readOrders() {
  return readJson(ORDERS_FILE, []);
}

function writeOrders(orders) {
  writeJson(ORDERS_FILE, orders.slice(0, MAX_ORDERS));
}

const LEGACY_DATE = '2026-01-01T00:00:00.000Z';

/* У товаров первых версий id — порядковый номер, а не метка времени.
   Без проверки такой id превращался бы в 1970 год и попадал в sitemap. */
function safeDate(raw) {
  if (raw.createdAt) {
    const parsed = Date.parse(raw.createdAt);
    if (Number.isFinite(parsed) && parsed > Date.parse('2020-01-01')) return raw.createdAt;
  }

  const fromId = Number(raw.id);
  if (Number.isFinite(fromId) && fromId > 1.5e12) return new Date(fromId).toISOString();

  return LEGACY_DATE;
}

/* Приводит товар к актуальной схеме — старые записи без новых полей не ломаются. */
function normalizeProduct(raw) {
  const images = Array.isArray(raw.images) && raw.images.length
    ? raw.images.filter(i => typeof i === 'string' && i)
    : (raw.image ? [raw.image] : []);

  return {
    id: Number(raw.id) || Date.now(),
    name: String(raw.name || 'Без названия'),
    category: String(raw.category || 'Букеты'),
    price: Number(raw.price) || 0,
    oldPrice: Number(raw.oldPrice) || 0,
    description: String(raw.description || ''),
    composition: String(raw.composition || ''),
    size: String(raw.size || ''),
    colors: Array.isArray(raw.colors) ? raw.colors.map(String) : [],
    occasions: Array.isArray(raw.occasions) ? raw.occasions.map(String) : [],
    image: images[0] || '',
    images,
    available: raw.available !== false,
    featured: raw.featured === true,
    createdAt: safeDate(raw)
  };
}

/* --------------------------------------------------------------------------
   Валидация входных данных
   -------------------------------------------------------------------------- */

function cleanText(value, max, fallback) {
  if (value === undefined || value === null) return fallback !== undefined ? fallback : '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanMultiline(value, max, fallback) {
  if (value === undefined || value === null) return fallback !== undefined ? fallback : '';
  return String(value).trim().slice(0, max);
}

function cleanNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 10000000) return fallback;
  return Math.round(n * 100) / 100;
}

function cleanBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value !== 'false' && value !== false && value !== '0';
}

function cleanList(value, max) {
  if (value === undefined || value === null || value === '') return [];
  let items = [];
  if (Array.isArray(value)) items = value;
  else {
    const text = String(value).trim();
    if (text.startsWith('[')) {
      try { items = JSON.parse(text); } catch { items = text.split(','); }
    } else {
      items = text.split(',');
    }
  }
  return items
    .map(i => cleanText(i, 40))
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, max);
}

/* Пропускает только наши загрузки и внешние http(s). Блокирует javascript:, data: и прочее. */
function cleanImageUrl(value) {
  const text = cleanText(value, 700);
  if (!text) return '';
  if (text.startsWith('/uploads/') && !text.includes('..')) return text;
  if (/^https:\/\/[^\s"'<>]+$/i.test(text)) return text;
  if (/^http:\/\/[^\s"'<>]+$/i.test(text)) return text;
  return '';
}

/* --------------------------------------------------------------------------
   Работа с файлами изображений
   -------------------------------------------------------------------------- */

function isOwnUpload(url) {
  return typeof url === 'string' && url.startsWith('/uploads/') && !url.includes('..');
}

/* Удаляет файлы, на которые больше не ссылается ни один товар. */
function removeUnusedUploads(candidates, products) {
  const used = new Set();
  products.forEach(p => (p.images || []).forEach(i => used.add(i)));

  candidates.filter(isOwnUpload).forEach(url => {
    if (used.has(url)) return;
    const full = path.join(UPLOAD_DIR, path.basename(url));
    if (!full.startsWith(UPLOAD_DIR)) return;
    try {
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch (e) {
      console.error('Не удалось удалить файл', full, e.message);
    }
  });
}

module.exports = {
  ROOT,
  DATA_DIR,
  UPLOAD_DIR,
  PRODUCTS_FILE,
  SETTINGS_FILE,
  ORDERS_FILE,
  MAX_ORDERS,
  MAX_IMAGES,
  MAX_UPLOAD_BYTES,
  defaultSettings,
  defaultProducts,
  readJson,
  writeJson,
  readProducts,
  writeProducts,
  readSettings,
  writeSettings,
  readOrders,
  writeOrders,
  normalizeProduct,
  cleanText,
  cleanMultiline,
  cleanNumber,
  cleanBool,
  cleanList,
  cleanImageUrl,
  isOwnUpload,
  removeUnusedUploads
};

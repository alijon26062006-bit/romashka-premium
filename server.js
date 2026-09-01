/* ==========================================================================
   Ромашка Premium — сервер интернет-магазина цветов
   Express 5 + Multer. Хранение: JSON-файлы в data/, изображения в uploads/.
   ========================================================================== */

const express = require('express');
const multer = require('multer');
const compression = require('compression');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* --------------------------------------------------------------------------
   Загрузка .env без внешних зависимостей
   -------------------------------------------------------------------------- */

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    const quoted = (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

/* --------------------------------------------------------------------------
   Конфигурация
   -------------------------------------------------------------------------- */

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const APP_VERSION = require('./package.json').version;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

const SESSION_TTL = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_ATTEMPTS = 10;
const ORDER_WINDOW = 60 * 60 * 1000;
const ORDER_LIMIT = 30;
const MAX_ORDERS = 500;
const MAX_IMAGES = 5;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/* Код проекта открыт, поэтому стандартный пароль известен всем.
   На боевом сервере запускаться с ним нельзя — иначе админка открыта любому. */
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || ADMIN_PASSWORD === 'admin123')) {
  console.error('');
  console.error('==========================================');
  console.error('❌ ЗАПУСК ОСТАНОВЛЕН');
  console.error('   Не задан ADMIN_PASSWORD — админка была бы открыта всем.');
  console.error('   Откройте файл .env и впишите свой пароль:');
  console.error('     ADMIN_PASSWORD=ваш-надёжный-пароль');
  console.error('   Либо запустите ./deploy.sh — он создаст пароль сам.');
  console.error('==========================================');
  console.error('');
  process.exit(1);
}

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
  metaDescription: 'Ромашка — цветочный магазин в Душанбе. Свежие букеты, композиции и доставка.'
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + safeExt);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_IMAGES },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Можно загружать только JPG, PNG или WEBP'));
  }
}).array('images', MAX_IMAGES);

/* Оборачиваем multer, чтобы его ошибки возвращались как понятный JSON. */
function uploadImages(req, res, next) {
  upload(req, res, function (error) {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Фото больше 8 МБ. Уменьшите размер и попробуйте снова.'
      : error.message || 'Не удалось загрузить фото';
    res.status(400).json({ error: message });
  });
}

/* --------------------------------------------------------------------------
   Сессии администратора и защита от подбора пароля
   -------------------------------------------------------------------------- */

const sessions = new Map();
const loginAttempts = new Map();
const orderAttempts = new Map();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

function hitLimit(store, key, limit, windowMs) {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

function validSession(token) {
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (Date.now() > expires) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!validSession(token)) {
    return res.status(401).json({ error: 'Сессия истекла. Войдите заново.' });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  sessions.forEach((expires, token) => { if (now > expires) sessions.delete(token); });
  loginAttempts.forEach((entry, key) => { if (now > entry.resetAt) loginAttempts.delete(key); });
  orderAttempts.forEach((entry, key) => { if (now > entry.resetAt) orderAttempts.delete(key); });
}, 10 * 60 * 1000).unref();

/* --------------------------------------------------------------------------
   Приложение
   -------------------------------------------------------------------------- */

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(compression());

app.use(function (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'"
  ].join('; '));
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* Имена файлов уникальны, поэтому загрузки кэшируются агрессивно. */
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '365d',
  immutable: true,
  fallthrough: true
}));

/* --------------------------------------------------------------------------
   Отдача HTML с подстановкой SEO-тегов (превью ссылок в WhatsApp)
   -------------------------------------------------------------------------- */

const htmlCache = new Map();

function readHtml(name) {
  const file = path.join(PUBLIC_DIR, name);
  const stat = fs.statSync(file);
  const cached = htmlCache.get(name);
  if (cached && cached.mtime === stat.mtimeMs) return cached.text;

  const text = fs.readFileSync(file, 'utf8');
  htmlCache.set(name, { mtime: stat.mtimeMs, text });
  return text;
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function baseUrl(req) {
  if (SITE_URL) return SITE_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return proto + '://' + req.get('host');
}

function absoluteUrl(req, url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return baseUrl(req) + url;
}

function renderHtml(req, res, name, seo) {
  let html;
  try {
    html = readHtml(name);
  } catch {
    return res.status(404).send('Страница не найдена');
  }

  const tags = [
    '<title>' + escapeHtml(seo.title) + '</title>',
    '<meta name="description" content="' + escapeHtml(seo.description) + '">',
    '<link rel="canonical" href="' + escapeHtml(seo.url) + '">',
    '<meta property="og:type" content="' + escapeHtml(seo.type || 'website') + '">',
    '<meta property="og:site_name" content="' + escapeHtml(seo.siteName) + '">',
    '<meta property="og:title" content="' + escapeHtml(seo.title) + '">',
    '<meta property="og:description" content="' + escapeHtml(seo.description) + '">',
    '<meta property="og:url" content="' + escapeHtml(seo.url) + '">',
    '<meta property="og:locale" content="ru_RU">',
    seo.image ? '<meta property="og:image" content="' + escapeHtml(seo.image) + '">' : '',
    seo.image ? '<meta property="og:image:width" content="1200">' : '',
    seo.image ? '<meta property="og:image:height" content="1200">' : '',
    '<meta name="twitter:card" content="' + (seo.image ? 'summary_large_image' : 'summary') + '">',
    seo.jsonLd ? '<script type="application/ld+json">' + JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c') + '</script>' : ''
  ].filter(Boolean).join('\n');

  const output = html
    .replace('<!--SEO-->', tags)
    .replace(/__VERSION__/g, APP_VERSION);

  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(output);
}

function renderIndex(req, res) {
  const settings = readSettings();
  const products = readProducts();
  const cover = products.find(p => p.image);

  renderHtml(req, res, 'index.html', {
    title: settings.shopName + ' — цветы с любовью' + (settings.city ? ' | ' + settings.city : ''),
    description: settings.metaDescription || defaultSettings.metaDescription,
    url: baseUrl(req) + '/',
    siteName: settings.shopName,
    image: cover ? absoluteUrl(req, cover.image) : '',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Florist',
      name: settings.shopName,
      description: settings.metaDescription,
      url: baseUrl(req) + '/',
      telephone: settings.phone,
      address: { '@type': 'PostalAddress', addressLocality: settings.city, streetAddress: settings.address || undefined },
      openingHours: settings.hours
    }
  });
}

function renderProduct(req, res) {
  const settings = readSettings();
  const products = readProducts();
  const product = products.find(p => String(p.id) === String(req.query.id));

  if (!product) {
    res.status(404);
    return renderHtml(req, res, 'product.html', {
      title: 'Букет не найден — ' + settings.shopName,
      description: 'Этот букет больше не доступен. Посмотрите весь каталог.',
      url: baseUrl(req) + '/product.html',
      siteName: settings.shopName,
      image: ''
    });
  }

  const price = product.price + ' ' + settings.currency;
  const description = (product.description || product.composition || '').slice(0, 200) ||
    ('Букет «' + product.name + '» — ' + price + '. ' + settings.deliveryNote + '.');

  renderHtml(req, res, 'product.html', {
    title: product.name + ' — ' + price + ' | ' + settings.shopName,
    description,
    url: baseUrl(req) + '/product.html?id=' + product.id,
    siteName: settings.shopName,
    type: 'product',
    image: absoluteUrl(req, product.image),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description,
      image: product.images.map(i => absoluteUrl(req, i)),
      category: product.category,
      offers: {
        '@type': 'Offer',
        price: product.price,
        priceCurrency: 'TJS',
        availability: product.available
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock'
      }
    }
  });
}

app.get('/', renderIndex);
app.get('/index.html', renderIndex);
app.get('/product.html', renderProduct);

app.get('/robots.txt', function (req, res) {
  res.type('text/plain').send(
    'User-agent: *\nAllow: /\nDisallow: /admin.html\nSitemap: ' + baseUrl(req) + '/sitemap.xml\n'
  );
});

app.get('/sitemap.xml', function (req, res) {
  const base = baseUrl(req);
  const urls = ['<url><loc>' + base + '/</loc><priority>1.0</priority></url>'];

  readProducts().forEach(p => {
    urls.push(
      '<url><loc>' + base + '/product.html?id=' + p.id + '</loc>' +
      '<lastmod>' + String(p.createdAt).slice(0, 10) + '</lastmod>' +
      '<priority>0.8</priority></url>'
    );
  });

  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') + '\n</urlset>'
  );
});

app.use(express.static(PUBLIC_DIR, {
  maxAge: '7d',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

/* --------------------------------------------------------------------------
   Публичное API
   -------------------------------------------------------------------------- */

function publicSettings(settings) {
  return {
    shopName: settings.shopName,
    tagline: settings.tagline,
    whatsapp: settings.whatsapp,
    phone: settings.phone,
    hours: settings.hours,
    city: settings.city,
    address: settings.address,
    instagram: settings.instagram,
    telegram: settings.telegram,
    deliveryNote: settings.deliveryNote,
    freshNote: settings.freshNote,
    currency: settings.currency
  };
}

/* Категории строятся из реальных товаров: пустых плиток на сайте не бывает. */
function buildCategories(products) {
  const map = new Map();

  products.forEach(p => {
    if (!p.category) return;
    const entry = map.get(p.category) || { name: p.category, count: 0, image: '' };
    entry.count += 1;
    if (!entry.image && p.image) entry.image = p.image;
    map.set(p.category, entry);
  });

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function sortProducts(products) {
  return products.slice().sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

app.get('/api/health', function (req, res) {
  res.json({ ok: true, version: APP_VERSION, uptime: Math.round(process.uptime()) });
});

app.get('/api/config', function (req, res) {
  res.json(publicSettings(readSettings()));
});

app.get('/api/products', function (req, res) {
  res.json(sortProducts(readProducts()));
});

app.get('/api/categories', function (req, res) {
  res.json(buildCategories(readProducts()));
});

/* Один запрос вместо трёх — главная страница грузится заметно быстрее. */
app.get('/api/bootstrap', function (req, res) {
  const products = sortProducts(readProducts());
  res.json({
    settings: publicSettings(readSettings()),
    products,
    categories: buildCategories(products)
  });
});

/* Заявка сохраняется до перехода в WhatsApp — владелец видит все обращения. */
app.post('/api/orders', function (req, res) {
  if (hitLimit(orderAttempts, clientIp(req), ORDER_LIMIT, ORDER_WINDOW)) {
    return res.status(429).json({ error: 'Слишком много заявок. Попробуйте позже.' });
  }

  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  if (!items.length) return res.status(400).json({ error: 'Корзина пуста' });

  const products = readProducts();
  const lines = [];
  let total = 0;

  items.forEach(item => {
    const product = products.find(p => String(p.id) === String(item.id));
    if (!product) return;
    const qty = Math.min(Math.max(Number(item.qty) || 1, 1), 99);
    total += product.price * qty;
    lines.push({ id: product.id, name: product.name, price: product.price, qty });
  });

  if (!lines.length) return res.status(400).json({ error: 'Товары не найдены' });

  const order = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    customer: cleanText(req.body.customer, 80),
    phone: cleanText(req.body.phone, 40),
    comment: cleanMultiline(req.body.comment, 500),
    items: lines,
    total,
    status: 'new'
  };

  const orders = readOrders();
  orders.unshift(order);
  writeOrders(orders);

  res.json({ ok: true, id: order.id, total });
});

/* --------------------------------------------------------------------------
   Вход в админ-панель
   -------------------------------------------------------------------------- */

app.post('/api/admin/login', function (req, res) {
  const ip = clientIp(req);

  if (hitLimit(loginAttempts, ip, LOGIN_ATTEMPTS, LOGIN_WINDOW)) {
    return res.status(429).json({ error: 'Слишком много попыток входа. Подождите 15 минут.' });
  }

  const userOk = safeEqual(req.body.username || '', ADMIN_USER);
  const passOk = safeEqual(req.body.password || '', ADMIN_PASSWORD);

  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  loginAttempts.delete(ip);
  res.json({ ok: true, token: createSession(), expiresIn: SESSION_TTL });
});

app.post('/api/admin/logout', auth, function (req, res) {
  sessions.delete((req.headers.authorization || '').slice(7));
  res.json({ ok: true });
});

app.get('/api/admin/session', auth, function (req, res) {
  res.json({ ok: true, user: ADMIN_USER });
});

/* --------------------------------------------------------------------------
   Управление товарами
   -------------------------------------------------------------------------- */

function collectImages(req, kept) {
  const uploaded = (req.files || []).map(f => '/uploads/' + f.filename);
  const fromUrl = cleanImageUrl(req.body.imageUrl);
  const all = kept.concat(uploaded);
  if (fromUrl && !all.includes(fromUrl)) all.push(fromUrl);
  return all.filter(Boolean).slice(0, MAX_IMAGES);
}

app.post('/api/products', auth, uploadImages, function (req, res) {
  const name = cleanText(req.body.name, 120);
  if (!name) return res.status(400).json({ error: 'Укажите название букета' });

  const price = cleanNumber(req.body.price, null);
  if (price === null) return res.status(400).json({ error: 'Укажите корректную цену' });

  const products = readProducts();
  const product = normalizeProduct({
    id: Date.now(),
    name,
    category: cleanText(req.body.category, 60, 'Букеты') || 'Букеты',
    price,
    oldPrice: cleanNumber(req.body.oldPrice, 0),
    description: cleanMultiline(req.body.description, 2000),
    composition: cleanText(req.body.composition, 300),
    size: cleanText(req.body.size, 60),
    colors: cleanList(req.body.colors, 8),
    occasions: cleanList(req.body.occasions, 8),
    images: collectImages(req, []),
    available: cleanBool(req.body.available, true),
    featured: cleanBool(req.body.featured, false),
    createdAt: new Date().toISOString()
  });

  products.unshift(product);
  writeProducts(products);
  res.json(product);
});

app.put('/api/products/:id', auth, uploadImages, function (req, res) {
  const id = Number(req.params.id);
  const products = readProducts();
  const index = products.findIndex(p => p.id === id);

  if (index === -1) {
    removeUnusedUploads((req.files || []).map(f => '/uploads/' + f.filename), products);
    return res.status(404).json({ error: 'Товар не найден' });
  }

  const old = products[index];
  let kept = old.images;

  if (req.body.keepImages !== undefined) {
    const requested = cleanList(req.body.keepImages, MAX_IMAGES);
    kept = old.images.filter(i => requested.includes(i));
  }

  const product = normalizeProduct({
    id: old.id,
    createdAt: old.createdAt,
    name: cleanText(req.body.name, 120, old.name) || old.name,
    category: cleanText(req.body.category, 60, old.category) || old.category,
    price: cleanNumber(req.body.price, old.price),
    oldPrice: cleanNumber(req.body.oldPrice, old.oldPrice),
    description: req.body.description !== undefined
      ? cleanMultiline(req.body.description, 2000)
      : old.description,
    composition: req.body.composition !== undefined
      ? cleanText(req.body.composition, 300)
      : old.composition,
    size: req.body.size !== undefined ? cleanText(req.body.size, 60) : old.size,
    colors: req.body.colors !== undefined ? cleanList(req.body.colors, 8) : old.colors,
    occasions: req.body.occasions !== undefined ? cleanList(req.body.occasions, 8) : old.occasions,
    images: collectImages(req, kept),
    available: cleanBool(req.body.available, old.available),
    featured: cleanBool(req.body.featured, old.featured)
  });

  products[index] = product;
  writeProducts(products);
  removeUnusedUploads(old.images, products);
  res.json(product);
});

/* Быстрое переключение наличия и метки «хит» прямо из карточки в админке. */
app.patch('/api/products/:id', auth, function (req, res) {
  const id = Number(req.params.id);
  const products = readProducts();
  const index = products.findIndex(p => p.id === id);

  if (index === -1) return res.status(404).json({ error: 'Товар не найден' });

  if (req.body.available !== undefined) {
    products[index].available = cleanBool(req.body.available, products[index].available);
  }
  if (req.body.featured !== undefined) {
    products[index].featured = cleanBool(req.body.featured, products[index].featured);
  }

  writeProducts(products);
  res.json(products[index]);
});

/* Клонирование — в цветочном магазине много похожих букетов. */
app.post('/api/products/:id/duplicate', auth, function (req, res) {
  const id = Number(req.params.id);
  const products = readProducts();
  const source = products.find(p => p.id === id);

  if (!source) return res.status(404).json({ error: 'Товар не найден' });

  const copy = normalizeProduct(Object.assign({}, source, {
    id: Date.now(),
    name: cleanText(source.name + ' (копия)', 120),
    createdAt: new Date().toISOString(),
    featured: false
  }));

  products.unshift(copy);
  writeProducts(products);
  res.json(copy);
});

app.delete('/api/products/:id', auth, function (req, res) {
  const id = Number(req.params.id);
  const products = readProducts();
  const target = products.find(p => p.id === id);

  if (!target) return res.status(404).json({ error: 'Товар не найден' });

  const remaining = products.filter(p => p.id !== id);
  writeProducts(remaining);
  removeUnusedUploads(target.images, remaining);
  res.json({ ok: true });
});

/* --------------------------------------------------------------------------
   Настройки магазина и заявки
   -------------------------------------------------------------------------- */

app.get('/api/admin/settings', auth, function (req, res) {
  res.json(readSettings());
});

app.put('/api/admin/settings', auth, function (req, res) {
  const current = readSettings();
  const body = req.body || {};

  const next = {
    shopName: cleanText(body.shopName, 60, current.shopName) || current.shopName,
    tagline: cleanText(body.tagline, 80, current.tagline),
    whatsapp: cleanText(body.whatsapp, 20, current.whatsapp).replace(/[^\d]/g, '') || current.whatsapp,
    phone: cleanText(body.phone, 40, current.phone),
    hours: cleanText(body.hours, 60, current.hours),
    city: cleanText(body.city, 60, current.city),
    address: cleanText(body.address, 160, current.address),
    instagram: cleanText(body.instagram, 160, current.instagram),
    telegram: cleanText(body.telegram, 160, current.telegram),
    deliveryNote: cleanText(body.deliveryNote, 80, current.deliveryNote),
    freshNote: cleanText(body.freshNote, 80, current.freshNote),
    currency: cleanText(body.currency, 20, current.currency) || current.currency,
    metaDescription: cleanText(body.metaDescription, 300, current.metaDescription)
  };

  writeSettings(next);
  htmlCache.clear();
  res.json(next);
});

app.get('/api/admin/orders', auth, function (req, res) {
  res.json(readOrders());
});

app.patch('/api/admin/orders/:id', auth, function (req, res) {
  const id = Number(req.params.id);
  const orders = readOrders();
  const index = orders.findIndex(o => o.id === id);

  if (index === -1) return res.status(404).json({ error: 'Заявка не найдена' });

  const allowed = ['new', 'done', 'cancelled'];
  if (allowed.includes(req.body.status)) orders[index].status = req.body.status;

  writeOrders(orders);
  res.json(orders[index]);
});

app.delete('/api/admin/orders/:id', auth, function (req, res) {
  const id = Number(req.params.id);
  const orders = readOrders();
  const remaining = orders.filter(o => o.id !== id);

  if (remaining.length === orders.length) {
    return res.status(404).json({ error: 'Заявка не найдена' });
  }

  writeOrders(remaining);
  res.json({ ok: true });
});

/* --------------------------------------------------------------------------
   Ошибки и фолбэк
   -------------------------------------------------------------------------- */

app.use(function (error, req, res, next) {
  if (!error) return next();
  console.error('Ошибка запроса:', error.message);
  const status = error.status || 400;
  res.status(status).json({ error: error.message || 'Что-то пошло не так' });
});

app.use(function (req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Метод не найден' });
  }

  /* Отсутствующий файл должен быть честным 404, а не главной страницей:
     иначе битые картинки «успешно» отдают HTML, а поисковики видят дубли. */
  const looksLikeFile = req.path.startsWith('/uploads/') || /\.[a-z0-9]{2,5}$/i.test(req.path);
  if (looksLikeFile) {
    return res.status(404).type('text/plain').send('Файл не найден');
  }

  res.status(404);
  renderIndex(req, res);
});

/* --------------------------------------------------------------------------
   Запуск
   -------------------------------------------------------------------------- */

const server = app.listen(PORT, HOST, function () {
  const insecure = ADMIN_PASSWORD === 'admin123';
  console.log('');
  console.log('==========================================');
  console.log('🌼 РОМАШКА PREMIUM  v' + APP_VERSION);
  console.log('🌐 ' + (SITE_URL || 'http://localhost:' + PORT));
  console.log('🔐 ' + (SITE_URL || 'http://localhost:' + PORT) + '/admin.html');
  console.log('👤 логин: ' + ADMIN_USER);
  if (insecure) {
    console.log('');
    console.log('⚠️  ВНИМАНИЕ: используется стандартный пароль admin123.');
    console.log('   Задайте ADMIN_PASSWORD в файле .env перед публикацией.');
  }
  console.log('==========================================');
});

function shutdown(signal) {
  console.log('\n' + signal + ' — останавливаю сервер...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

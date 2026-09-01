/* ==========================================================================
   Ромашка Premium — панель управления в Telegram

   Бот делает то же, что и веб-админка: добавляет товары, убирает их с
   витрины, удаляет и показывает посещаемость сайта. Данные общие — модуль
   store.js, — поэтому товар, добавленный из телеграма, появляется на сайте
   сразу, а удалённый там исчезает и здесь.

   Внешних библиотек нет: Telegram Bot API — это обычный HTTP, а fetch
   встроен в Node начиная с 18-й версии. Работаем длинным опросом
   (getUpdates), так что ни белого IP, ни вебхука, ни отдельного домена
   не нужно — бот сам ходит за обновлениями.

   Включается, только если в .env заданы TELEGRAM_BOT_TOKEN и
   TELEGRAM_ADMIN_IDS. Без них сервер работает как раньше.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const stats = require('./stats');

const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const API = 'https://api.telegram.org/bot' + TOKEN;
const FILE_API = 'https://api.telegram.org/file/bot' + TOKEN;

/* Кто имеет право управлять магазином. Список числовых id через запятую. */
const ADMIN_IDS = String(process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(s => /^\d+$/.test(s));

const POLL_TIMEOUT = 30;              // сколько секунд Telegram держит запрос
const REQUEST_TIMEOUT = 45 * 1000;    // свой предел — чуть больше, на случай зависшего соединения
const PAGE_SIZE = 8;                  // товаров на страницу списка
const MAX_CATEGORY_BUTTONS = 24;      // сколько категорий показываем кнопками
const DRAFT_TTL = 30 * 60 * 1000;     // незаконченная карточка живёт полчаса

let running = false;
let offset = 0;
let activeAbort = null;

/* Незаконченные мастера: chatId → { kind, step, data, at }.
   kind различает, что человек сейчас заполняет: карточку товара или номер. */
const drafts = new Map();

/* --------------------------------------------------------------------------
   Обращения к Telegram
   -------------------------------------------------------------------------- */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function call(method, payload) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT);
  if (method === 'getUpdates') activeAbort = abort;

  try {
    const res = await fetch(API + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: abort.signal
    });

    const json = await res.json();
    if (!json.ok) throw new Error(json.description || ('Telegram: ошибка ' + res.status));
    return json.result;
  } finally {
    clearTimeout(timer);
    if (activeAbort === abort) activeAbort = null;
  }
}

/* Ошибку отправки глушим: из-за одного неотправленного сообщения
   останавливать весь бот незачем. */
async function quiet(method, payload) {
  try {
    return await call(method, payload);
  } catch (e) {
    console.error('Телеграм-бот: ' + method + ' — ' + e.message);
    return null;
  }
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function send(chatId, text, keyboard) {
  return quiet('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: keyboard
  });
}

function edit(chatId, messageId, text, keyboard) {
  return quiet('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: keyboard
  });
}

/* --------------------------------------------------------------------------
   Клавиатуры
   -------------------------------------------------------------------------- */

const MENU = {
  keyboard: [
    [{ text: '➕ Добавить товар' }, { text: '📦 Товары' }],
    [{ text: '📊 Статистика' }, { text: '🧾 Заявки' }],
    [{ text: '⚙️ Настройки' }]
  ],
  resize_keyboard: true
};

const CANCEL = {
  keyboard: [[{ text: '✖️ Отменить' }]],
  resize_keyboard: true
};

function productListKeyboard(products, page) {
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = products.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const rows = slice.map(p => [{
    text: (p.available ? '' : '🚫 ') + p.name + ' · ' + p.price,
    callback_data: 'card:' + p.id
  }]);

  if (pages > 1) {
    const nav = [];
    if (current > 0) nav.push({ text: '◀️', callback_data: 'list:' + (current - 1) });
    nav.push({ text: (current + 1) + ' из ' + pages, callback_data: 'noop' });
    if (current < pages - 1) nav.push({ text: '▶️', callback_data: 'list:' + (current + 1) });
    rows.push(nav);
  }

  return { inline_keyboard: rows };
}

function cardKeyboard(product) {
  return {
    inline_keyboard: [
      [
        {
          text: product.available ? '🚫 Убрать с витрины' : '✅ Вернуть на витрину',
          callback_data: 'toggle:' + product.id
        }
      ],
      [{ text: '🗑 Удалить', callback_data: 'ask:' + product.id }],
      [{ text: '◀️ К списку', callback_data: 'list:0' }]
    ]
  };
}

/* --------------------------------------------------------------------------
   Тексты
   -------------------------------------------------------------------------- */

function money(value) {
  const settings = store.readSettings();
  return value + ' ' + (settings.currency || '');
}

function productCard(product) {
  const lines = [
    '<b>' + escapeHtml(product.name) + '</b>',
    'Категория: ' + escapeHtml(product.category),
    'Цена: ' + escapeHtml(money(product.price)),
    'На витрине: ' + (product.available ? 'да' : 'нет')
  ];

  if (product.description) lines.push('', escapeHtml(product.description));
  if (product.images && product.images.length) lines.push('', 'Фото: ' + product.images.length + ' шт.');

  return lines.join('\n');
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function people(n) {
  return n + ' ' + plural(n, 'человек', 'человека', 'человек');
}

function views(n) {
  return n + ' ' + plural(n, 'просмотр', 'просмотра', 'просмотров');
}

function statsText() {
  const products = store.readProducts();
  const orders = store.readOrders();
  const s = stats.summary(products);

  const lines = [
    '📊 <b>Посещаемость сайта</b>',
    '',
    'Сегодня: ' + people(s.today.visitors) + ', ' + views(s.today.views),
    'Вчера: ' + people(s.yesterday.visitors) + ', ' + views(s.yesterday.views),
    'За 7 дней: ' + people(s.week.visitors) + ', ' + views(s.week.views),
    'За 30 дней: ' + people(s.month.visitors) + ', ' + views(s.month.views),
    '',
    'Всего просмотров: ' + s.totalViews
  ];

  if (s.top.length) {
    lines.push('', '🔝 <b>Чаще всего открывали</b>');
    s.top.forEach((item, i) => {
      lines.push((i + 1) + '. ' + escapeHtml(item.name) + ' — ' + views(item.views));
    });
  }

  const fresh = orders.filter(o => o.status === 'new').length;
  lines.push(
    '',
    '🧾 Заявок: ' + orders.length + ', из них новых ' + fresh,
    '📦 Товаров: ' + products.length,
    '',
    '<i>Учитываются просмотры людьми, роботы отсеиваются. Один человек за день считается один раз. Время — ' + escapeHtml(s.timezone) + '.</i>'
  );

  return lines.join('\n');
}

function ordersText() {
  const orders = store.readOrders().slice(0, 10);
  if (!orders.length) return '🧾 Заявок пока нет.';

  const lines = ['🧾 <b>Последние заявки</b>', ''];

  orders.forEach(order => {
    const when = new Date(order.createdAt).toLocaleString('ru-RU', { timeZone: process.env.SHOP_TZ || 'Asia/Dushanbe' });
    lines.push('<b>' + escapeHtml(order.customer || 'Без имени') + '</b> · ' + escapeHtml(order.phone || 'без телефона'));
    lines.push(when + ' · ' + escapeHtml(money(order.total)) + (order.status === 'new' ? ' · 🆕' : ''));
    order.items.forEach(item => {
      lines.push('   • ' + escapeHtml(item.name) + ' × ' + item.qty);
    });

    /* Адрес — главное в заявке: по нему поедет курьер. */
    if (order.delivery === 'Самовывоз') {
      lines.push('   🏬 Самовывоз');
    } else if (order.street || order.city) {
      let address = [order.city, order.street].filter(Boolean).join(', ');
      if (order.house) address += ', дом ' + order.house;
      if (order.apartment) address += ', кв. ' + order.apartment;
      lines.push('   🚚 ' + escapeHtml(address));
      if (order.landmark) lines.push('   🧭 ' + escapeHtml(order.landmark));
    }

    if (order.when) lines.push('   🕒 ' + escapeHtml(order.when));
    if (order.comment) lines.push('   💬 ' + escapeHtml(order.comment));
    lines.push('');
  });

  return lines.join('\n').trim();
}

/* --------------------------------------------------------------------------
   Добавление товара: шаг за шагом
   -------------------------------------------------------------------------- */

const STEPS = ['name', 'category', 'price', 'description', 'photo'];

const PROMPTS = {
  name: 'Шаг 1 из 5. Как называется букет?\n\n<i>Например: Нежная ромашка</i>',
  category: 'Шаг 2 из 5. В какую категорию его поставить?\n\n<i>Нажмите кнопку ниже или напишите свою категорию — она тоже сохранится и появится в кнопках</i>',
  price: 'Шаг 3 из 5. Сколько стоит? Только число.\n\n<i>Например: 250</i>',
  description: 'Шаг 4 из 5. Короткое описание для карточки.\n\n<i>Или отправьте «-», чтобы пропустить</i>',
  photo: 'Шаг 5 из 5. Пришлите фотографию букета.\n\n<i>Можно отправить ссылку на картинку или «-», чтобы обойтись без фото</i>'
};

/* Обычные для цветочного магазина категории. Нужны, когда каталог пуст или
   в нём пока одна-две позиции: иначе на втором шаге кнопок почти нет и всё
   приходится набирать руками. Свои категории магазина идут первыми. */
const BASE_CATEGORIES = [
  'Букеты', 'Розы', 'Ромашки', 'Тюльпаны', 'Пионы', 'Хризантемы',
  'Лилии', 'Орхидеи', 'Гвоздики', 'Герберы', 'Композиции', 'Корзины',
  'Коробки', 'Сухоцветы', 'Комнатные растения', 'Свадебные', 'Траурные',
  'Шары', 'Подарки', 'Сладости'
];

/* Все категории, какие есть: сначала настоящие из каталога, потом готовые. */
function allCategories() {
  const list = [];
  const add = (name) => {
    const clean = store.cleanText(name, 60);
    if (clean && !list.includes(clean)) list.push(clean);
  };

  store.readProducts().forEach(p => add(p.category));
  BASE_CATEGORIES.forEach(add);

  return list.slice(0, MAX_CATEGORY_BUTTONS);
}

function categoryKeyboard() {
  const categories = allCategories();

  const rows = [];
  for (let i = 0; i < categories.length; i += 2) {
    rows.push(categories.slice(i, i + 2).map(c => ({ text: c })));
  }
  rows.push([{ text: '✖️ Отменить' }]);

  return { keyboard: rows, resize_keyboard: true };
}

function askStep(chatId, step) {
  const keyboard = step === 'category' ? categoryKeyboard() : CANCEL;
  return send(chatId, PROMPTS[step], keyboard);
}

function draftPreview(data) {
  return [
    'Проверьте карточку:',
    '',
    '<b>' + escapeHtml(data.name) + '</b>',
    'Категория: ' + escapeHtml(data.category),
    'Цена: ' + escapeHtml(money(data.price)),
    data.description ? '\n' + escapeHtml(data.description) : '',
    data.images.length ? '\n📷 Фото добавлено' : '\n📷 Без фото'
  ].filter(Boolean).join('\n');
}

const CONFIRM = {
  inline_keyboard: [[
    { text: '💾 Сохранить', callback_data: 'save' },
    { text: '✖️ Отменить', callback_data: 'drop' }
  ]]
};

async function downloadPhoto(fileId) {
  const file = await call('getFile', { file_id: fileId });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(FILE_API + '/' + file.file_path, { signal: abort.signal });
    if (!res.ok) throw new Error('Telegram не отдал файл');

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > store.MAX_UPLOAD_BYTES) throw new Error('Фото больше 8 МБ');

    const ext = path.extname(file.file_path || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const name = Date.now() + '-' + crypto.randomBytes(5).toString('hex') + safeExt;

    fs.writeFileSync(path.join(store.UPLOAD_DIR, name), buffer);
    return '/uploads/' + name;
  } finally {
    clearTimeout(timer);
  }
}

/* Возвращает true, если сообщение съел мастер добавления товара. */
async function feedDraft(chatId, message) {
  const draft = drafts.get(chatId);
  if (!draft) return false;

  const text = String(message.text || '').trim();
  const step = draft.step;
  draft.at = Date.now();

  if (draft.kind === 'whatsapp') return feedWhatsapp(chatId, draft, text);

  if (step === 'name') {
    const name = store.cleanText(text, 120);
    if (!name) {
      await send(chatId, 'Название пустое. Напишите, как называется букет.', CANCEL);
      return true;
    }
    draft.data.name = name;
    draft.step = 'category';
    await askStep(chatId, 'category');
    return true;
  }

  if (step === 'category') {
    const category = store.cleanText(text, 60);
    if (!category) {
      await send(chatId, 'Категория пустая. Выберите кнопкой или напишите свою.', categoryKeyboard());
      return true;
    }
    draft.data.category = category;
    draft.step = 'price';
    await askStep(chatId, 'price');
    return true;
  }

  if (step === 'price') {
    const price = store.cleanNumber(text, null);
    if (price === null || price <= 0) {
      await send(chatId, 'Не понял цену. Пришлите число, например 250.', CANCEL);
      return true;
    }
    draft.data.price = price;
    draft.step = 'description';
    await askStep(chatId, 'description');
    return true;
  }

  if (step === 'description') {
    draft.data.description = text === '-' ? '' : store.cleanMultiline(text, 1200);
    draft.step = 'photo';
    await askStep(chatId, 'photo');
    return true;
  }

  if (step === 'photo') {
    if (Array.isArray(message.photo) && message.photo.length) {
      /* Telegram присылает несколько размеров — берём самый крупный. */
      const largest = message.photo[message.photo.length - 1];
      await send(chatId, 'Загружаю фото…');
      try {
        draft.data.images = [await downloadPhoto(largest.file_id)];
      } catch (e) {
        await send(chatId, 'Не получилось сохранить фото: ' + escapeHtml(e.message) + '\nПришлите другое или отправьте «-».', CANCEL);
        return true;
      }
    } else if (text === '-') {
      draft.data.images = [];
    } else {
      const url = store.cleanImageUrl(text);
      if (!url) {
        await send(chatId, 'Это не похоже на фото или ссылку. Пришлите картинку или «-».', CANCEL);
        return true;
      }
      draft.data.images = [url];
    }

    draft.step = 'confirm';
    await send(chatId, draftPreview(draft.data), { remove_keyboard: true });
    await send(chatId, 'Сохранить товар на сайт?', CONFIRM);
    return true;
  }

  if (step === 'confirm') {
    await send(chatId, 'Нажмите «Сохранить» или «Отменить» под карточкой.');
    return true;
  }

  return false;
}

function saveDraft(chatId) {
  const draft = drafts.get(chatId);
  if (!draft) return null;

  const product = store.normalizeProduct({
    id: Date.now(),
    name: draft.data.name,
    category: draft.data.category,
    price: draft.data.price,
    description: draft.data.description,
    images: draft.data.images,
    image: draft.data.images[0] || '',
    available: true,
    featured: false,
    createdAt: new Date().toISOString()
  });

  const products = store.readProducts();
  products.push(product);
  store.writeProducts(products);
  drafts.delete(chatId);

  return product;
}

/* --------------------------------------------------------------------------
   Номер WhatsApp, на который уходят заказы
   -------------------------------------------------------------------------- */

/* wa.me принимает только цифры с кодом страны. Всё остальное — плюсы, скобки,
   пробелы, дефисы — выбрасываем. Местный девятизначный номер дополняем кодом
   Таджикистана: его почти всегда диктуют без 992. */
function normalizeWhatsapp(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 9) digits = '992' + digits;
  return digits;
}

/* Таджикский номер показываем привычными группами, остальные — как есть. */
function prettyPhone(digits) {
  const match = /^992(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  if (match) return '+992 ' + match[1] + ' ' + match[2] + ' ' + match[3] + ' ' + match[4];
  return '+' + digits;
}

function settingsText() {
  const settings = store.readSettings();

  return [
    '⚙️ <b>Настройки магазина</b>',
    '',
    'Магазин: ' + escapeHtml(settings.shopName || '—'),
    'Заказы уходят на WhatsApp: <b>' + escapeHtml(prettyPhone(String(settings.whatsapp || ''))) + '</b>',
    'Телефон на сайте: ' + escapeHtml(settings.phone || '—'),
    'Город: ' + escapeHtml(settings.city || '—'),
    'Валюта: ' + escapeHtml(settings.currency || '—'),
    '',
    '<i>Остальное меняется в веб-панели, в разделе «Настройки».</i>'
  ].join('\n');
}

const SETTINGS_KEYBOARD = {
  inline_keyboard: [[{ text: '📱 Изменить номер WhatsApp', callback_data: 'wa' }]]
};

async function feedWhatsapp(chatId, draft, text) {
  if (draft.step === 'number') {
    const digits = normalizeWhatsapp(text);

    if (digits.length < 10 || digits.length > 15) {
      await send(
        chatId,
        'Не похоже на номер. Пришлите его с кодом страны, например <code>+992 90 140 32 63</code>,\n' +
        'или просто девять цифр — код Таджикистана добавлю сам.',
        CANCEL
      );
      return true;
    }

    draft.data.whatsapp = digits;
    draft.step = 'confirm';

    await send(
      chatId,
      'Новый номер для заказов:\n\n<b>' + escapeHtml(prettyPhone(digits)) + '</b>\n' +
      'Ссылка: wa.me/' + escapeHtml(digits) + '\n\n' +
      'Проверьте, что он верный — после сохранения все заказы с сайта пойдут сюда.',
      { remove_keyboard: true }
    );
    await send(chatId, 'Сохранить этот номер?', {
      inline_keyboard: [[
        { text: '💾 Сохранить', callback_data: 'wasave' },
        { text: '✖️ Отменить', callback_data: 'drop' }
      ]]
    });
    return true;
  }

  if (draft.step === 'confirm') {
    await send(chatId, 'Нажмите «Сохранить» или «Отменить» под номером.');
    return true;
  }

  return false;
}

/* --------------------------------------------------------------------------
   Обработка сообщений
   -------------------------------------------------------------------------- */

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

async function refuse(chatId, userId) {
  if (ADMIN_IDS.length) {
    return send(chatId, 'Этот бот управляет магазином. Доступ только у владельца.');
  }

  /* Владелец ещё не назначен — показываем, что вписать в .env.
     Как только список заполнен, эта подсказка посторонним не достаётся. */
  return send(
    chatId,
    'Бот запущен, но владелец ещё не назначен.\n\n' +
    'Впишите в файл <code>.env</code> на сервере строку:\n' +
    '<code>TELEGRAM_ADMIN_IDS=' + escapeHtml(userId) + '</code>\n\n' +
    'и пересоберите магазин той же командой, которой ставили — ' +
    '<code>./deploy.sh</code> или <code>./deploy-nginx.sh</code>.'
  );
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from && message.from.id;

  if (!isAdmin(userId)) return refuse(chatId, userId);

  const text = String(message.text || '').trim();

  if (text === '/start' || text === '/menu') {
    drafts.delete(chatId);
    return send(
      chatId,
      '🌼 <b>Ромашка Premium</b>\nПанель управления магазином.\n\n' +
      'Здесь можно добавить букет на сайт, убрать его с витрины, удалить и посмотреть, сколько людей заходило.',
      MENU
    );
  }

  if (text === '✖️ Отменить' || text === '/cancel') {
    const had = drafts.delete(chatId);
    return send(chatId, had ? 'Добавление отменено.' : 'Отменять нечего.', MENU);
  }

  /* Мастер добавления перехватывает ввод, пока карточка не закончена.
     Команды со слэшем — исключение, иначе «/stats» стал бы названием букета. */
  if (!text.startsWith('/') && await feedDraft(chatId, message)) return;

  if (text === '➕ Добавить товар' || text === '/add') {
    drafts.set(chatId, { kind: 'product', step: 'name', at: Date.now(), data: { images: [], description: '' } });
    return askStep(chatId, 'name');
  }

  if (text === '📦 Товары' || text === '/products') {
    const products = store.readProducts();
    if (!products.length) return send(chatId, 'Каталог пуст. Нажмите «➕ Добавить товар».', MENU);
    return send(chatId, '📦 <b>Товары</b>\nВыберите, чтобы удалить или убрать с витрины:', productListKeyboard(products, 0));
  }

  if (text === '📊 Статистика' || text === '/stats') {
    return send(chatId, statsText(), MENU);
  }

  if (text === '🧾 Заявки' || text === '/orders') {
    return send(chatId, ordersText(), MENU);
  }

  if (text === '⚙️ Настройки' || text === '/settings') {
    return send(chatId, settingsText(), SETTINGS_KEYBOARD);
  }

  return send(chatId, 'Не понял. Выберите действие кнопкой ниже.', MENU);
}

async function handleCallback(query) {
  const message = query.message;
  const chatId = message.chat.id;
  const userId = query.from && query.from.id;

  const done = (text) => quiet('answerCallbackQuery', { callback_query_id: query.id, text });

  if (!isAdmin(userId)) {
    await done('Доступ только у владельца магазина');
    return;
  }

  const data = String(query.data || '');
  const [action, arg] = data.split(':');

  if (action === 'noop') return done();

  if (action === 'list') {
    const products = store.readProducts();
    if (!products.length) {
      await edit(chatId, message.message_id, 'Каталог пуст.');
      return done();
    }
    await edit(chatId, message.message_id, '📦 <b>Товары</b>\nВыберите, чтобы удалить или убрать с витрины:', productListKeyboard(products, Number(arg) || 0));
    return done();
  }

  if (action === 'card') {
    const product = store.readProducts().find(p => String(p.id) === arg);
    if (!product) {
      await edit(chatId, message.message_id, 'Этот товар уже удалён.');
      return done();
    }
    await edit(chatId, message.message_id, productCard(product), cardKeyboard(product));
    return done();
  }

  if (action === 'toggle') {
    const products = store.readProducts();
    const product = products.find(p => String(p.id) === arg);
    if (!product) {
      await edit(chatId, message.message_id, 'Этот товар уже удалён.');
      return done();
    }
    product.available = !product.available;
    store.writeProducts(products);
    await edit(chatId, message.message_id, productCard(product), cardKeyboard(product));
    return done(product.available ? 'Вернули на витрину' : 'Убрали с витрины');
  }

  if (action === 'ask') {
    const product = store.readProducts().find(p => String(p.id) === arg);
    if (!product) {
      await edit(chatId, message.message_id, 'Этот товар уже удалён.');
      return done();
    }
    await edit(
      chatId,
      message.message_id,
      'Удалить «' + escapeHtml(product.name) + '» насовсем?\n\n<i>Товар исчезнет с сайта, фотографию тоже удалим.</i>',
      {
        inline_keyboard: [[
          { text: '🗑 Да, удалить', callback_data: 'kill:' + product.id },
          { text: '◀️ Нет', callback_data: 'card:' + product.id }
        ]]
      }
    );
    return done();
  }

  if (action === 'kill') {
    const products = store.readProducts();
    const product = products.find(p => String(p.id) === arg);
    if (!product) {
      await edit(chatId, message.message_id, 'Этот товар уже удалён.');
      return done();
    }

    const left = products.filter(p => String(p.id) !== arg);
    store.writeProducts(left);
    /* Фото удаляем только если его не использует другой товар. */
    store.removeUnusedUploads(product.images || [], left);

    await edit(
      chatId,
      message.message_id,
      '🗑 «' + escapeHtml(product.name) + '» удалён.',
      left.length ? { inline_keyboard: [[{ text: '◀️ К списку', callback_data: 'list:0' }]] } : undefined
    );
    return done('Удалено');
  }

  if (action === 'wa') {
    drafts.set(chatId, { kind: 'whatsapp', step: 'number', at: Date.now(), data: {} });
    await done();
    return send(
      chatId,
      'Пришлите новый номер WhatsApp, на который будут приходить заказы.\n\n' +
      '<i>Можно с кодом страны — <code>+992 90 140 32 63</code>, можно просто девять цифр.</i>',
      CANCEL
    );
  }

  if (action === 'wasave') {
    const draft = drafts.get(chatId);
    if (!draft || draft.kind !== 'whatsapp' || !draft.data.whatsapp) {
      await edit(chatId, message.message_id, 'Номер потерялся — начните заново.');
      return done();
    }

    const settings = store.readSettings();
    const previous = String(settings.whatsapp || '');
    settings.whatsapp = draft.data.whatsapp;
    store.writeSettings(settings);
    drafts.delete(chatId);

    await edit(
      chatId,
      message.message_id,
      '✅ Готово. Заказы с сайта теперь уходят на <b>' + escapeHtml(prettyPhone(settings.whatsapp)) + '</b>' +
      (previous && previous !== settings.whatsapp ? '\n\n<i>Прежний номер: ' + escapeHtml(prettyPhone(previous)) + '</i>' : ''),
      { inline_keyboard: [[{ text: '📞 Показать его и на сайте', callback_data: 'waphone' }]] }
    );
    await send(chatId, 'Что дальше?', MENU);
    return done('Номер сохранён');
  }

  if (action === 'waphone') {
    const settings = store.readSettings();
    settings.phone = prettyPhone(String(settings.whatsapp || ''));
    store.writeSettings(settings);

    await edit(
      chatId,
      message.message_id,
      '✅ Заказы уходят на <b>' + escapeHtml(prettyPhone(String(settings.whatsapp || ''))) + '</b>\n' +
      'Этот же номер теперь показан на сайте как контактный.'
    );
    return done('Готово');
  }

  if (action === 'save') {
    const product = saveDraft(chatId);
    if (!product) {
      await edit(chatId, message.message_id, 'Карточка потерялась — начните заново.');
      return done();
    }
    await edit(chatId, message.message_id, '✅ «' + escapeHtml(product.name) + '» уже на сайте.');
    await send(chatId, 'Что дальше?', MENU);
    return done('Сохранено');
  }

  if (action === 'drop') {
    drafts.delete(chatId);
    await edit(chatId, message.message_id, 'Добавление отменено.');
    await send(chatId, 'Что дальше?', MENU);
    return done();
  }

  return done();
}

async function handleUpdate(update) {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) return handleCallback(update.callback_query);
}

/* --------------------------------------------------------------------------
   Длинный опрос
   -------------------------------------------------------------------------- */

function dropStaleDrafts() {
  const now = Date.now();
  drafts.forEach((draft, chatId) => {
    if (now - draft.at > DRAFT_TTL) drafts.delete(chatId);
  });
}

async function poll() {
  let failures = 0;

  while (running) {
    try {
      const updates = await call('getUpdates', {
        offset,
        timeout: POLL_TIMEOUT,
        allowed_updates: ['message', 'callback_query']
      });

      failures = 0;
      dropStaleDrafts();

      for (const update of updates) {
        offset = update.update_id + 1;
        if (!running) break;
        try {
          await handleUpdate(update);
        } catch (e) {
          console.error('Телеграм-бот: не смог обработать сообщение —', e.message);
        }
      }
    } catch (e) {
      if (!running) break;

      /* Сеть на сервере иногда пропадает. Ждём всё дольше, но не больше минуты. */
      failures += 1;
      const wait = Math.min(60000, 1000 * Math.pow(2, Math.min(failures, 6)));
      console.error('Телеграм-бот: ' + e.message + ' — повтор через ' + Math.round(wait / 1000) + ' с');
      await delay(wait);
    }
  }
}

async function start() {
  if (!TOKEN) return false;

  if (!ADMIN_IDS.length) {
    console.log('⚠️  Телеграм-бот: не задан TELEGRAM_ADMIN_IDS — бот запущен, но подскажет ваш id в ответ на любое сообщение.');
  }

  let me;
  try {
    me = await call('getMe');
  } catch (e) {
    console.error('❌ Телеграм-бот не запущен: ' + e.message);
    console.error('   Проверьте TELEGRAM_BOT_TOKEN в файле .env');
    return false;
  }

  running = true;
  poll().catch(e => console.error('Телеграм-бот остановлен:', e.message));

  console.log('🤖 Телеграм-бот: @' + me.username + (ADMIN_IDS.length ? ' (владельцев: ' + ADMIN_IDS.length + ')' : ''));
  return true;
}

function stop() {
  running = false;
  if (activeAbort) activeAbort.abort();
}

module.exports = { start, stop, enabled: Boolean(TOKEN) };

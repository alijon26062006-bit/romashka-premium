/* ==========================================================================
   Проверка телеграм-панели и счётчика посещений

   Настоящий Telegram здесь не нужен: bot.js общается с ним обычным HTTP,
   поэтому мы подменяем fetch и разыгрываем переписку — от «/start» до
   удаления товара. Данные пишутся во временную папку, каталог магазина
   на сервере тест не трогает.

   Запуск:  npm test
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Свои папки для данных — обязательно до первого require('../store'). */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'romashka-test-'));
process.env.DATA_DIR = path.join(SANDBOX, 'data');
process.env.UPLOAD_DIR = path.join(SANDBOX, 'uploads');
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_ADMIN_IDS = '111';
process.env.SHOP_TZ = 'Asia/Dushanbe';

const OWNER = 111;
const STRANGER = 999;
const CHAT = 500;

const sent = [];      // что бот отправил
const batches = [];   // очередь обновлений, которые «придут» из Telegram
let updateId = 1;

function msg(text, from = OWNER, extra = {}) {
  return {
    update_id: updateId++,
    message: Object.assign({ chat: { id: CHAT }, from: { id: from }, text }, extra)
  };
}

function cb(data, from = OWNER) {
  return {
    update_id: updateId++,
    callback_query: {
      id: 'q' + updateId,
      from: { id: from },
      data,
      message: { chat: { id: CHAT }, message_id: 42 }
    }
  };
}

/* Начало настоящего PNG — больше для проверки загрузки не нужно. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function reply(result) {
  return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
}

global.fetch = async function (url, options) {
  if (url.startsWith('https://api.telegram.org/file/')) {
    return { ok: true, arrayBuffer: async () => PNG };
  }

  const method = url.slice(url.lastIndexOf('/') + 1);

  if (method === 'getMe') return reply({ id: 1, username: 'romashka_test_bot' });
  if (method === 'getFile') return reply({ file_path: 'photos/file_1.jpg' });

  if (method === 'getUpdates') {
    const next = batches.shift();
    if (next) return reply(next);
    await new Promise(r => setTimeout(r, 20));
    return reply([]);
  }

  sent.push({ method, payload: options && options.body ? JSON.parse(options.body) : {} });
  return reply({ message_id: 42 });
};

const store = require('../store');
const stats = require('../stats');
const bot = require('../bot');

function texts() {
  return sent
    .filter(s => s.method === 'sendMessage' || s.method === 'editMessageText')
    .map(s => s.payload.text);
}

function last() {
  const all = texts();
  return all[all.length - 1];
}

function waitFor(check, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > 5000) {
        return reject(new Error('Не дождался ответа: ' + label + '\n   последнее сообщение: ' + last()));
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

async function step(update, expect, label) {
  const before = texts().length;
  batches.push([update]);
  await waitFor(() => texts().length > before, label);

  if (expect) {
    const answer = texts().slice(before).join('\n');
    assert.ok(
      answer.includes(expect),
      label + '\n   ожидалось: ' + expect + '\n   получено:  ' + answer
    );
  }
  console.log('  ✓ ' + label);
}

function uploads() {
  return fs.readdirSync(process.env.UPLOAD_DIR);
}

(async () => {
  store.writeProducts([]);
  await bot.start();

  console.log('\nДоступ');
  await step(msg('/start', STRANGER), 'только у владельца', 'посторонний получает отказ');
  await step(msg('/start'), 'Панель управления', 'владелец видит меню');

  console.log('\nДобавление товара по шагам');
  await step(msg('➕ Добавить товар'), 'Шаг 1 из 5', 'шаг 1 — название');
  await step(msg('Тестовый букет'), 'Шаг 2 из 5', 'шаг 2 — категория');

  /* Каталог пуст, но кнопки категорий всё равно должны быть — из готового списка. */
  const keyboard = sent[sent.length - 1].payload.reply_markup.keyboard;
  const buttons = keyboard.flat().map(b => b.text);
  assert.ok(buttons.length > 10, 'категорий кнопками должно быть много, а не ' + buttons.length);
  assert.ok(buttons.includes('Розы') && buttons.includes('Букеты'), 'нет обычных категорий: ' + buttons.join(', '));
  assert.ok(buttons.includes('✖️ Отменить'), 'нет кнопки отмены');
  console.log('  ✓ категорий кнопками: ' + (buttons.length - 1));

  await step(msg('Розы'), 'Шаг 3 из 5', 'шаг 3 — цена');
  await step(msg('не число'), 'Не понял цену', 'нечисловая цена не проходит');
  await step(msg('250'), 'Шаг 4 из 5', 'шаг 4 — описание');
  await step(msg('Красивый букет'), 'Шаг 5 из 5', 'шаг 5 — фото');
  await step(
    msg('', OWNER, { photo: [{ file_id: 'small' }, { file_id: 'big' }] }),
    'Сохранить товар',
    'фото принято, показан предпросмотр'
  );

  assert.equal(uploads().length, 1, 'фотография должна лечь в uploads/');
  console.log('  ✓ фото сохранено: ' + uploads()[0]);

  await step(cb('save'), 'уже на сайте', 'товар сохранён');

  const products = store.readProducts();
  assert.equal(products.length, 1, 'в каталоге должен быть ровно один товар');
  assert.equal(products[0].name, 'Тестовый букет');
  assert.equal(products[0].price, 250);
  assert.equal(products[0].category, 'Розы');
  assert.equal(products[0].available, true);
  assert.ok(products[0].image.startsWith('/uploads/'), 'фото должно быть привязано к товару');
  console.log('  ✓ карточка в каталоге заполнена верно');

  console.log('\nСписок, витрина, удаление');
  const id = products[0].id;
  await step(msg('📦 Товары'), 'Товары', 'список открывается');
  await step(cb('card:' + id), 'Тестовый букет', 'карточка товара');
  await step(cb('toggle:' + id), 'На витрине: нет', 'товар убран с витрины');
  assert.equal(store.readProducts()[0].available, false);
  await step(cb('toggle:' + id), 'На витрине: да', 'товар возвращён на витрину');
  await step(cb('ask:' + id), 'насовсем', 'удаление спрашивает подтверждение');
  await step(cb('kill:' + id), 'удалён', 'товар удалён');

  assert.equal(store.readProducts().length, 0, 'каталог должен опустеть');
  assert.equal(uploads().length, 0, 'фото удалённого товара тоже должно исчезнуть');
  console.log('  ✓ товар и его фотография удалены');

  console.log('\nЧужие нажатия');
  const before = texts().length;
  batches.push([cb('kill:' + id, STRANGER)]);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(texts().length, before, 'постороннему бот не должен отвечать на кнопку');
  console.log('  ✓ кнопки от посторонних игнорируются');

  console.log('\nСчётчик посещений');
  const visitor = (ip, agent) => ({ ip, headers: { 'user-agent': agent || 'Mozilla/5.0 (iPhone)' } });
  stats.track(visitor('1.1.1.1'));
  stats.track(visitor('1.1.1.1'));                   // тот же человек, второй просмотр
  stats.track(visitor('2.2.2.2'));
  stats.track(visitor('3.3.3.3', 'Googlebot/2.1'));  // робот — не считается

  const summary = stats.summary([]);
  assert.equal(summary.today.views, 3, 'должно быть три просмотра живыми людьми');
  assert.equal(summary.today.visitors, 2, 'должно быть два разных посетителя');
  console.log('  ✓ 3 просмотра, 2 посетителя, робот отсеян');

  await step(msg('📊 Статистика'), 'Посещаемость сайта', 'бот показывает сводку');
  assert.ok(last().includes('2 человека'), 'склонение сломано: ' + last());
  console.log('  ✓ склонения верные — «' + last().split('\n')[2] + '»');

  console.log('\nНомер WhatsApp');
  const before2 = store.readSettings().whatsapp;
  await step(msg('⚙️ Настройки'), 'Заказы уходят на WhatsApp', 'настройки открываются');

  await step(cb('wa'), 'Пришлите новый номер', 'мастер смены номера запущен');
  await step(msg('всякая ерунда'), 'Не похоже на номер', 'мусор вместо номера не проходит');

  /* Девять цифр — местный номер, код страны бот добавляет сам. */
  await step(msg('901403263'), '+992 90 140 32 63', 'девятизначный дополнен кодом 992');
  assert.equal(store.readSettings().whatsapp, before2, 'до подтверждения ничего не меняется');
  console.log('  ✓ до подтверждения настройки не тронуты');

  await step(cb('wasave'), 'Заказы с сайта теперь уходят', 'номер сохранён');
  assert.equal(store.readSettings().whatsapp, '992901403263', 'в настройках должен лежать номер из цифр');
  console.log('  ✓ в настройках: ' + store.readSettings().whatsapp);

  /* Номер с плюсом, скобками и пробелами — тоже должен разбираться. */
  await step(cb('wa'), 'Пришлите новый номер', 'мастер запущен снова');
  await step(msg('+992 (44) 600-70-80'), 'wa.me/992446007080', 'номер с плюсом и скобками разобран');
  await step(cb('wasave'), 'теперь уходят', 'второй номер сохранён');
  assert.equal(store.readSettings().whatsapp, '992446007080');
  console.log('  ✓ смена номера повторяется');

  await step(cb('waphone'), 'показан на сайте как контактный', 'номер показан и на сайте');
  assert.equal(store.readSettings().phone, '+992 44 600 70 80', 'телефон на сайте: ' + store.readSettings().phone);
  console.log('  ✓ контактный телефон на сайте: ' + store.readSettings().phone);

  await step(msg('⚙️ Настройки'), '+992 44 600 70 80', 'в настройках виден новый номер');

  bot.stop();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log('\n✅ Все проверки прошли\n');
  process.exit(0);
})().catch(error => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.error('\n❌ ' + error.message + '\n');
  process.exit(1);
});

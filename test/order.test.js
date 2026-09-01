/* ==========================================================================
   Проверка оформления заказа

   Поднимаем настоящий сервер на свободном порту со своей папкой данных,
   отправляем заявки так же, как их шлёт витрина, и смотрим, что легло в
   orders.json. Каталог магазина не трогается.

   Запуск:  npm test
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'romashka-order-'));
const DATA_DIR = path.join(SANDBOX, 'data');
const PORT = 3400 + Math.floor(Math.random() * 400);
const BASE = 'http://127.0.0.1:' + PORT;

const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    DATA_DIR,
    UPLOAD_DIR: path.join(SANDBOX, 'uploads'),
    ADMIN_PASSWORD: 'test-pass',
    TELEGRAM_BOT_TOKEN: '',
    NODE_ENV: 'test'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

function stop() {
  server.kill('SIGTERM');
  fs.rmSync(SANDBOX, { recursive: true, force: true });
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch { /* ещё не поднялся */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Сервер не запустился за 6 секунд:\n' + serverLog);
}

function post(body) {
  return fetch(BASE + '/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function orders() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'orders.json'), 'utf8'));
}

(async () => {
  await waitForServer();

  const products = await (await fetch(BASE + '/api/products')).json();
  const first = products[0];
  assert.ok(first, 'в каталоге по умолчанию должен быть хотя бы один товар');

  console.log('\nДоставка с полным адресом');
  let res = await post({
    items: [{ id: first.id, qty: 2 }],
    customer: 'Алиджон',
    phone: '+992 90 140 32 63',
    delivery: 'Доставка',
    city: 'Душанбе',
    street: 'улица Рудаки',
    house: '45',
    apartment: '12',
    landmark: 'возле школы №10',
    when: 'сегодня к 18:00',
    comment: 'положите открытку'
  });
  assert.equal(res.status, 200, 'заявка должна приниматься');

  let saved = orders()[0];
  assert.equal(saved.customer, 'Алиджон');
  assert.equal(saved.phone, '+992 90 140 32 63');
  assert.equal(saved.delivery, 'Доставка');
  assert.equal(saved.city, 'Душанбе');
  assert.equal(saved.street, 'улица Рудаки');
  assert.equal(saved.house, '45');
  assert.equal(saved.apartment, '12');
  assert.equal(saved.landmark, 'возле школы №10');
  assert.equal(saved.when, 'сегодня к 18:00');
  assert.equal(saved.comment, 'положите открытку');
  console.log('  ✓ имя, телефон, город, улица, дом, квартира, ориентир и время сохранены');

  assert.equal(saved.total, first.price * 2, 'сумму считает сервер по своим ценам');
  console.log('  ✓ сумма посчитана сервером: ' + saved.total);

  console.log('\nСамовывоз');
  await post({
    items: [{ id: first.id, qty: 1 }],
    customer: 'Фаррух',
    phone: '900000000',
    delivery: 'Самовывоз',
    city: 'Душанбе',
    street: 'улица, которой быть не должно',
    house: '1'
  });

  saved = orders()[0];
  assert.equal(saved.delivery, 'Самовывоз');
  assert.equal(saved.street, '', 'при самовывозе адрес не сохраняется');
  assert.equal(saved.city, '');
  console.log('  ✓ адрес при самовывозе отброшен');

  console.log('\nПодделанные данные');
  await post({
    items: [{ id: first.id, qty: 3 }],
    customer: 'Тест',
    phone: '900000001',
    delivery: 'что угодно',
    city: 'Худжанд',
    street: 'улица Ленина',
    house: '7'
  });

  saved = orders()[0];
  assert.equal(saved.delivery, 'Доставка', 'неизвестный способ получения считается доставкой');
  assert.equal(saved.city, 'Худжанд');
  console.log('  ✓ неизвестный способ получения не превращается в самовывоз');

  /* Цену клиент не передаёт вовсе, но проверим, что подсунутая игнорируется. */
  await post({
    items: [{ id: first.id, qty: 1, price: 1 }],
    customer: 'Тест',
    phone: '900000002',
    delivery: 'Самовывоз'
  });
  assert.equal(orders()[0].total, first.price, 'цена из запроса игнорируется');
  console.log('  ✓ цену из запроса сервер не берёт');

  console.log('\nПустая корзина');
  res = await post({ items: [], customer: 'Тест', phone: '900000003' });
  assert.equal(res.status, 400, 'пустой заказ должен отклоняться');
  console.log('  ✓ пустой заказ отклонён');

  stop();
  console.log('\n✅ Оформление заказа работает\n');
  process.exit(0);
})().catch(error => {
  console.error('\n❌ ' + error.message + '\n');
  console.error(serverLog);
  stop();
  process.exit(1);
});

/* ==========================================================================
   Проверка SEO

   Смотрим глазами поисковика: что в <title>, есть ли описание и канонический
   адрес, разбирается ли разметка Schema.org, ведут ли старые ссылки на новые,
   и не потерялись ли страницы из карты сайта.

   Запуск:  npm test
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const seo = require('../seo');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'romashka-seo-'));
const DATA_DIR = path.join(SANDBOX, 'data');
const PORT = 3800 + Math.floor(Math.random() * 150);
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
      if ((await fetch(BASE + '/api/health')).ok) return;
    } catch { /* ещё не поднялся */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Сервер не запустился:\n' + serverLog);
}

function pick(html, re, what) {
  const m = re.exec(html);
  assert.ok(m, 'в разметке нет: ' + what);
  return m[1];
}

function jsonLd(html) {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  return blocks.map(b => JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '').replace(/\\u003c/g, '<')));
}

(async () => {
  console.log('\nПадежи и адреса (без сервера)');
  assert.equal(seo.inCity('Душанбе'), 'Душанбе');
  assert.equal(seo.inCity('Худжанд'), 'Худжанде');
  assert.equal(seo.inCity('Исфара'), 'Исфаре');
  assert.equal(seo.inCity('Куляб'), 'Кулябе');
  assert.equal(seo.inCity(''), '');
  console.log('  ✓ город склоняется: в Душанбе, в Худжанде, в Исфаре, в Кулябе');

  assert.equal(seo.slug('Нежная ромашка'), 'nezhnaya-romashka');
  assert.equal(seo.slug('Букет «Любовь» №1'), 'buket-lyubov-1');
  assert.equal(seo.productPath({ id: 17, name: 'Розовая мечта' }), '/bukety/17-rozovaya-mechta');
  console.log('  ✓ адрес букета: /bukety/17-rozovaya-mechta');

  await waitForServer();

  console.log('\nГлавная страница');
  const home = await (await fetch(BASE + '/')).text();

  const title = pick(home, /<title>([^<]+)<\/title>/, '<title>');
  assert.ok(title.startsWith('Доставка цветов в Душанбе'), 'заголовок должен начинаться с запроса: ' + title);
  assert.ok(title.length <= seo.TITLE_LIMIT, 'заголовок длиннее ' + seo.TITLE_LIMIT + ': ' + title.length);
  console.log('  ✓ <title>: ' + title);

  const description = pick(home, /<meta name="description" content="([^"]+)">/, 'описание');
  assert.ok(description.length <= seo.DESCRIPTION_LIMIT, 'описание длиннее ' + seo.DESCRIPTION_LIMIT);
  assert.ok(/доставк/i.test(description), 'в описании нет слова «доставка»');
  console.log('  ✓ описание: ' + description);

  const h1 = pick(home, /<h1>([\s\S]*?)<\/h1>/, 'заголовок H1');
  assert.ok(/Душанбе/.test(h1), 'в H1 нет города: ' + h1);
  assert.equal((home.match(/<h1[ >]/g) || []).length, 1, 'H1 должен быть ровно один');
  console.log('  ✓ H1: ' + h1.replace(/<[^>]+>/g, ' ').trim());

  assert.ok(home.includes('<link rel="canonical"'), 'нет канонического адреса');
  assert.ok(home.includes('og:image'), 'нет картинки для превью');
  console.log('  ✓ канонический адрес и превью на месте');

  const homeGraph = jsonLd(home)[0]['@graph'];
  const types = homeGraph.map(n => n['@type']);
  assert.deepEqual(types, ['WebSite', 'Florist', 'ItemList'], 'разметка главной: ' + types.join(', '));

  const shop = homeGraph.find(n => n['@type'] === 'Florist');
  assert.ok(shop.openingHoursSpecification, 'часы работы не разобраны');
  assert.equal(shop.openingHoursSpecification.opens, '08:00');
  assert.equal(shop.openingHoursSpecification.closes, '22:00');
  assert.equal(shop.address.addressLocality, 'Душанбе');
  assert.ok(shop.priceRange, 'нет диапазона цен');
  console.log('  ✓ разметка магазина: часы ' + shop.openingHoursSpecification.opens +
    '–' + shop.openingHoursSpecification.closes + ', цены ' + shop.priceRange);

  const list = homeGraph.find(n => n['@type'] === 'ItemList');
  assert.ok(list.itemListElement.length > 0, 'каталог пуст в разметке');
  assert.ok(list.itemListElement[0].url.includes('/bukety/'), 'в списке старые адреса');
  console.log('  ✓ в разметке каталога букетов: ' + list.itemListElement.length);

  console.log('\nСтраница букета');
  const products = await (await fetch(BASE + '/api/products')).json();
  const product = products[0];
  const url = seo.productPath(product);

  const page = await (await fetch(BASE + url)).text();
  const productTitleText = pick(page, /<title>([^<]+)<\/title>/, '<title>');
  assert.ok(productTitleText.includes(product.name), 'в заголовке нет названия букета');
  assert.ok(productTitleText.length <= seo.TITLE_LIMIT, 'заголовок длиннее нормы: ' + productTitleText);
  console.log('  ✓ <title>: ' + productTitleText);

  const canonical = pick(page, /<link rel="canonical" href="([^"]+)">/, 'канонический адрес');
  assert.ok(canonical.endsWith(url), 'канонический адрес не тот: ' + canonical);
  console.log('  ✓ канонический адрес: ' + canonical);

  const productGraph = jsonLd(page)[0]['@graph'];
  const card = productGraph.find(n => n['@type'] === 'Product');
  assert.equal(card.offers.priceCurrency, 'TJS', 'валюта должна быть кодом ISO');
  assert.equal(card.offers.price, product.price);
  assert.equal(card.sku, String(product.id));
  assert.ok(card.offers.availability.includes('InStock'));

  const crumbs = productGraph.find(n => n['@type'] === 'BreadcrumbList');
  assert.equal(crumbs.itemListElement.length, 3, 'в крошках должно быть три звена');
  console.log('  ✓ разметка товара: цена ' + card.offers.price + ' TJS, в наличии, крошки из 3 звеньев');

  console.log('\nСтарые ссылки');
  const old = await fetch(BASE + '/product.html?id=' + product.id, { redirect: 'manual' });
  assert.equal(old.status, 301, 'старый адрес должен вести постоянным редиректом');
  assert.equal(old.headers.get('location'), url);
  console.log('  ✓ /product.html?id=' + product.id + ' → 301 → ' + url);

  const renamed = await fetch(BASE + '/bukety/' + product.id + '-staroe-nazvanie', { redirect: 'manual' });
  assert.equal(renamed.status, 301, 'адрес со старым названием должен вести на новый');
  assert.equal(renamed.headers.get('location'), url);
  console.log('  ✓ адрес со старым названием тоже уводит на верный');

  const missing = await fetch(BASE + '/bukety/999999-net-takogo');
  assert.equal(missing.status, 404, 'несуществующий букет должен отдавать 404');
  console.log('  ✓ несуществующий букет отдаёт 404, а не 200');

  console.log('\nКарта сайта и robots');
  const map = await (await fetch(BASE + '/sitemap.xml')).text();
  assert.ok(map.includes('<loc>' + BASE + '/</loc>'), 'в карте нет главной');
  assert.ok(map.includes(BASE + url), 'в карте нет букета по новому адресу');
  assert.ok(!map.includes('product.html?id='), 'в карте остались старые адреса');
  assert.ok(map.includes('<image:loc>'), 'в карте нет картинок');
  assert.equal((map.match(/<url>/g) || []).length, products.length + 1, 'в карте не все страницы');
  console.log('  ✓ в карте сайта ' + (products.length + 1) + ' страниц, с датами и картинками');

  const robots = await (await fetch(BASE + '/robots.txt')).text();
  assert.ok(robots.includes('Sitemap: ' + BASE + '/sitemap.xml'), 'robots.txt не указывает на карту');
  assert.ok(robots.includes('Disallow: /admin.html'), 'админка не закрыта от индексации');
  console.log('  ✓ robots.txt указывает на карту и закрывает админку');

  console.log('\nПодтверждение прав в поисковиках');
  assert.ok(!home.includes('google-site-verification'), 'пустой код не должен попадать в разметку');

  const login = await (await fetch(BASE + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-pass' })
  })).json();

  await fetch(BASE + '/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token },
    body: JSON.stringify({ googleVerification: 'abc123', yandexVerification: 'xyz789' })
  });

  const verified = await (await fetch(BASE + '/')).text();
  assert.ok(verified.includes('<meta name="google-site-verification" content="abc123">'), 'нет кода Google');
  assert.ok(verified.includes('<meta name="yandex-verification" content="xyz789">'), 'нет кода Яндекса');
  console.log('  ✓ коды Google и Яндекса попадают в <head> после сохранения');

  stop();
  console.log('\n✅ SEO в порядке\n');
  process.exit(0);
})().catch(error => {
  console.error('\n❌ ' + error.message + '\n');
  console.error(serverLog);
  stop();
  process.exit(1);
});

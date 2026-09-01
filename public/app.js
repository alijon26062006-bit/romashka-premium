/* ==========================================================================
   Ромашка Premium — витрина магазина
   ========================================================================== */

let allProducts = [];
let allCategories = [];
let settings = { whatsapp: '992901403263', currency: 'сомони', shopName: 'Ромашка' };
let activeCategory = 'Все';
let cart = JSON.parse(localStorage.getItem('romashka_cart') || '[]');

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const money = n => Number(n || 0).toLocaleString('ru-RU') + ' ' + (settings.currency || 'сомони');

const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#f3ebe6"/><text x="300" y="330" font-size="110" text-anchor="middle" fill="#cdb8b0">&#10047;</text></svg>'
);

/* Битая ссылка на фото больше не ломает сетку каталога. */
function imgFallback(el) {
  el.onerror = null;
  el.src = PLACEHOLDER;
}

/* Unsplash отдаёт картинку любой ширины — в сетке незачем грузить 1200px. */
function thumb(url, width) {
  if (typeof url !== 'string' || !url) return PLACEHOLDER;
  if (url.includes('images.unsplash.com')) return url.replace(/([?&]w=)\d+/, '$1' + width);
  return url;
}

function waUrl(text = 'Здравствуйте! Хочу узнать подробнее о букетах магазина ' + (settings.shopName || 'Ромашка') + ' 🌸', number) {
  return 'https://wa.me/' + (number || settings.whatsapp) + '?text=' + encodeURIComponent(text);
}

/* --------------------------------------------------------------------------
   Корзина
   -------------------------------------------------------------------------- */

function saveCart() {
  localStorage.setItem('romashka_cart', JSON.stringify(cart));
  renderCart();
}

function addToCart(id) {
  const product = allProducts.find(x => x.id === id);
  if (!product || !product.available) return;

  const item = cart.find(x => x.id === id);
  if (item) item.qty++; else cart.push({ id, qty: 1 });

  saveCart();
  openCart();
  toast('Букет добавлен в корзину ♡');
}

function changeQty(id, delta) {
  const item = cart.find(x => x.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(x => x.id !== id);
  saveCart();
}

function cartDetails() {
  return cart
    .map(i => ({ ...i, product: allProducts.find(p => p.id === i.id) }))
    .filter(i => i.product);
}

function renderCart() {
  const items = cartDetails();
  const count = items.reduce((s, i) => s + i.qty, 0);
  const total = items.reduce((s, i) => s + i.qty * Number(i.product.price), 0);

  $('#cartCount').textContent = count > 99 ? '99+' : count;
  $('#cartTotal').textContent = money(total);

  $('#cartItems').innerHTML = items.length ? items.map(i => `<div class="cart-item"><img src="${esc(thumb(i.product.image, 200))}" alt="${esc(i.product.name)}" onerror="imgFallback(this)"><div><h4>${esc(i.product.name)}</h4><small>${money(i.product.price)}</small><div class="qty"><button onclick="changeQty(${i.id},-1)">−</button><span>${i.qty}</span><button onclick="changeQty(${i.id},1)">+</button></div></div><button class="remove" onclick="changeQty(${i.id},-${i.qty})" aria-label="Удалить">×</button></div>`).join('')
    : '<div class="cart-empty"><div style="font-size:30px;margin-bottom:12px">♡</div>Ваша корзина пока пуста.<br>Добавьте понравившийся букет.</div>';

  /* Ссылка ведёт на оформление, а адрес нужен как запасной вариант,
     если скрипт почему-то не отработает. */
  $('#cartWhatsApp').href = waUrl();
}

function openCart() {
  /* Корзина всегда открывается списком: если в прошлый раз ушли на форму
     и закрыли шторку, возвращаться туда с устаревшими данными незачем. */
  showCart();
  $('#cartDrawer').classList.add('open');
  $('#cartOverlay').classList.add('open');
  document.body.classList.add('no-scroll');
}

function closeCart() {
  $('#cartDrawer').classList.remove('open');
  $('#cartOverlay').classList.remove('open');
  document.body.classList.remove('no-scroll');
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* --------------------------------------------------------------------------
   Оформление заказа: контакты и адрес доставки
   -------------------------------------------------------------------------- */

/* Города Таджикистана. Свой город магазина всегда идёт первым, а если клиент
   из другого места — в конце есть «Другой город» с полем для ввода. */
const CITIES = [
  'Душанбе', 'Худжанд', 'Бохтар', 'Куляб', 'Истаравшан', 'Турсунзаде',
  'Исфара', 'Пенджикент', 'Вахдат', 'Гиссар', 'Канибадам', 'Дангара',
  'Рогун', 'Хорог', 'Нурек', 'Яван'
];

const OTHER_CITY = 'Другой город';

/* Что клиент вводил в прошлый раз — чтобы не набирать адрес заново. */
function savedCustomer() {
  try {
    return JSON.parse(localStorage.getItem('romashka_customer') || '{}');
  } catch {
    return {};
  }
}

function rememberCustomer(data) {
  try {
    localStorage.setItem('romashka_customer', JSON.stringify(data));
  } catch { /* приватный режим браузера — просто не запомним */ }
}

function fillCities(selected) {
  const list = [];
  const add = name => { if (name && !list.includes(name)) list.push(name); };

  add(settings.city);
  CITIES.forEach(add);

  const value = selected && list.includes(selected) ? selected : list[0];

  $('#fCity').innerHTML = list.concat(OTHER_CITY)
    .map(c => `<option${c === value ? ' selected' : ''}>${esc(c)}</option>`).join('');
}

function isDelivery() {
  const picked = document.querySelector('input[name="delivery"]:checked');
  return !picked || picked.value === 'Доставка';
}

function syncDeliveryFields() {
  $('#addressFields').hidden = !isDelivery();
  $('#cityOtherWrap').hidden = !isDelivery() || $('#fCity').value !== OTHER_CITY;
}

function showCheckout() {
  const items = cartDetails();
  const total = items.reduce((s, i) => s + i.qty * Number(i.product.price), 0);
  const saved = savedCustomer();

  $('#checkoutTotal').textContent = money(total);
  $('#fName').value = saved.customer || '';
  $('#fPhone').value = saved.phone || '';
  $('#fStreet').value = saved.street || '';
  $('#fHouse').value = saved.house || '';
  $('#fFlat').value = saved.apartment || '';
  $('#fLandmark').value = saved.landmark || '';
  $('#fWhen').value = '';
  $('#fComment').value = '';

  fillCities(saved.city);
  if (saved.city && $('#fCity').value === OTHER_CITY) $('#fCityOther').value = saved.city;

  hideError();
  syncDeliveryFields();

  $('#cartView').hidden = true;
  $('#checkoutView').hidden = false;
  $('#checkoutView').scrollTop = 0;
}

function showCart() {
  $('#checkoutView').hidden = true;
  $('#cartView').hidden = false;
}

function hideError() {
  $('#checkoutError').hidden = true;
  document.querySelectorAll('.field .bad').forEach(el => el.classList.remove('bad'));
}

function showError(message, field) {
  const box = $('#checkoutError');
  box.textContent = message;
  box.hidden = false;

  if (field) {
    field.classList.add('bad');
    field.focus();
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/* Телефон принимаем в любом виде, но цифр должно хватать на настоящий номер. */
function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function collectOrder() {
  const delivery = isDelivery() ? 'Доставка' : 'Самовывоз';
  const chosenCity = $('#fCity').value;

  return {
    customer: $('#fName').value.trim(),
    phone: $('#fPhone').value.trim(),
    delivery,
    city: delivery === 'Доставка' ? (chosenCity === OTHER_CITY ? $('#fCityOther').value.trim() : chosenCity) : '',
    street: delivery === 'Доставка' ? $('#fStreet').value.trim() : '',
    house: delivery === 'Доставка' ? $('#fHouse').value.trim() : '',
    apartment: delivery === 'Доставка' ? $('#fFlat').value.trim() : '',
    landmark: delivery === 'Доставка' ? $('#fLandmark').value.trim() : '',
    when: $('#fWhen').value.trim(),
    comment: $('#fComment').value.trim()
  };
}

function validateOrder(order) {
  if (!order.customer) return { message: 'Напишите, пожалуйста, ваше имя.', field: $('#fName') };
  if (phoneDigits(order.phone).length < 9) return { message: 'Проверьте номер телефона — по нему магазин с вами свяжется.', field: $('#fPhone') };

  if (order.delivery === 'Доставка') {
    if (!order.city) return { message: 'Укажите город доставки.', field: $('#fCityOther') };
    if (!order.street) return { message: 'Укажите улицу или район — без адреса курьер не приедет.', field: $('#fStreet') };
    if (!order.house) return { message: 'Укажите номер дома.', field: $('#fHouse') };
  }

  return null;
}

/* Готовое сообщение для WhatsApp: клиенту останется только нажать «отправить». */
function orderText(order, items, total) {
  const lines = items.map(i => `• ${i.product.name} × ${i.qty} — ${money(i.product.price * i.qty)}`);

  const parts = [
    `Здравствуйте! 🌸 Хочу оформить заказ в магазине «${settings.shopName || 'Ромашка'}».`,
    '',
    '🛍 Букеты:',
    lines.join('\n'),
    `Итого: ${money(total)}`,
    '',
    `👤 Имя: ${order.customer}`,
    `📞 Телефон: ${order.phone}`
  ];

  if (order.delivery === 'Доставка') {
    const address = order.street + ', дом ' + order.house + (order.apartment ? ', кв. ' + order.apartment : '');
    parts.push('', '🚚 Доставка', `🏙 Город: ${order.city}`, `📍 Адрес: ${address}`);
    if (order.landmark) parts.push(`🧭 Ориентир: ${order.landmark}`);
  } else {
    parts.push('', '🏬 Заберу сам из магазина');
  }

  if (order.when) parts.push(`🕒 Когда: ${order.when}`);
  if (order.comment) parts.push('', `💬 ${order.comment}`);

  return parts.join('\n');
}

async function submitOrder(event) {
  event.preventDefault();

  const items = cartDetails();
  if (!items.length) {
    showCart();
    toast('Корзина пуста');
    return;
  }

  const order = collectOrder();
  hideError();

  const problem = validateOrder(order);
  if (problem) {
    showError(problem.message, problem.field);
    return;
  }

  const total = items.reduce((s, i) => s + i.qty * Number(i.product.price), 0);
  rememberCustomer(order);

  const button = $('#checkoutView button[type="submit"]');
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Отправляем…';

  /* Заявка уходит на сервер до перехода в WhatsApp — владелец видит её, даже
     если клиент передумает отправлять сообщение. В ответе приходит актуальный
     номер: страница могла быть открыта до того, как владелец сменил его из
     телеграма. Ждём недолго — если сервер молчит, уходим на номер, который
     знали при загрузке. */
  let number = settings.whatsapp;

  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2500);

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ items: cart.map(i => ({ id: i.id, qty: i.qty })) }, order)),
      keepalive: true,
      signal: abort.signal
    });

    clearTimeout(timer);

    const data = await res.json();
    if (data && data.whatsapp) {
      number = data.whatsapp;
      settings.whatsapp = data.whatsapp;
    }
  } catch (e) { /* сеть подвела — заказ всё равно уйдёт в WhatsApp */ }

  button.disabled = false;
  button.innerHTML = label;

  location.href = waUrl(orderText(order, items, total), number);
}

/* --------------------------------------------------------------------------
   Категории и каталог
   -------------------------------------------------------------------------- */

/* Плитки строятся из реальных товаров — пустых категорий на сайте не бывает. */
function renderCategories() {
  const section = document.querySelector('.category-section');
  if (!allCategories.length) {
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = '';

  $('#categoryGrid').innerHTML = allCategories.slice(0, 6).map(c =>
    `<button class="category-card" data-cat="${esc(c.name)}"><img src="${esc(thumb(c.image, 500))}" alt="${esc(c.name)}" loading="lazy" onerror="imgFallback(this)"><div><b>${esc(c.name)}</b><small>${c.count} ${plural(c.count)}</small></div></button>`
  ).join('');

  $('#categoryGrid').querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => selectCategory(card.dataset.cat));
  });
}

function plural(n) {
  return n === 1 ? 'товар' : n >= 2 && n <= 4 ? 'товара' : 'товаров';
}

function selectCategory(cat) {
  activeCategory = cat || 'Все';
  document.querySelector('#catalog').scrollIntoView({ behavior: 'smooth' });
  renderFilters();
  renderProducts();
}

function renderFilters() {
  const cats = ['Все', ...allCategories.map(c => c.name)];
  $('#filters').innerHTML = cats.map(c =>
    `<button class="filter ${c === activeCategory ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join('');

  document.querySelectorAll('.filter').forEach(b => b.addEventListener('click', () => {
    activeCategory = b.dataset.cat;
    renderFilters();
    renderProducts();
  }));
}

function renderProducts() {
  const query = ($('#searchInput')?.value || '').trim().toLowerCase();

  const products = allProducts.filter(p => {
    if (activeCategory !== 'Все' && p.category !== activeCategory) return false;
    if (!query) return true;
    const haystack = `${p.name} ${p.category} ${p.description} ${p.composition} ${(p.occasions || []).join(' ')} ${(p.colors || []).join(' ')}`;
    return haystack.toLowerCase().includes(query);
  });

  $('#catalogCount').textContent = `${products.length} ${plural(products.length)}`;

  if (!products.length) {
    $('#productGrid').innerHTML = '<div class="loading">По вашему запросу ничего не найдено.</div>';
    return;
  }

  $('#productGrid').innerHTML = products.map((p, i) => `<article class="product" style="animation-delay:${Math.min(i, 8) * 45}ms">
 <div class="product-photo" onclick="openProduct(${p.id})"><img src="${esc(thumb(p.image, 600))}" alt="${esc(p.name)}" loading="lazy" onerror="imgFallback(this)">${p.featured ? '<span class="product-ribbon">Хит</span>' : ''}
 <div class="product-overlay"><span class="quick">Подробнее →</span>${p.available ? `<button class="add-quick" onclick="event.stopPropagation();addToCart(${p.id})">В корзину</button>` : ''}</div></div>
 <div class="product-info" onclick="openProduct(${p.id})"><div><h3>${esc(p.name)}</h3><small>${esc(p.category)}${p.available ? '' : ' · нет в наличии'}</small></div><div class="price">${p.oldPrice > p.price ? `<s>${money(p.oldPrice)}</s> ` : ''}${money(p.price)}</div></div></article>`).join('');
}

function openProduct(id) {
  location.href = '/product.html?id=' + encodeURIComponent(id);
}

function checkout() {
  if (!cart.length) {
    toast('Сначала добавьте букет в корзину');
    return;
  }
  showCheckout();
}

/* --------------------------------------------------------------------------
   Подстановка настроек магазина в вёрстку
   -------------------------------------------------------------------------- */

function applySettings() {
  const general = waUrl();
  ['phoneLink', 'heroWhatsApp', 'ctaWhatsApp', 'floatingWhatsApp'].forEach(id => {
    const el = $('#' + id);
    if (el) el.href = general;
  });

  const setText = (selector, value) => {
    const el = $(selector);
    if (el && value) el.textContent = value;
  };

  setText('#phoneText', settings.phone);
  setText('#hoursText', settings.hours);
  setText('#topFresh', settings.freshNote);
  setText('#topDelivery', settings.deliveryNote);
  setText('#topHours', settings.hours);

  if (settings.shopName) {
    document.querySelectorAll('.brand-copy b').forEach(el => { el.textContent = settings.shopName; });
  }
  if (settings.tagline) {
    document.querySelectorAll('.brand-copy small').forEach(el => { el.textContent = settings.tagline; });
  }
}

/* --------------------------------------------------------------------------
   Старт
   -------------------------------------------------------------------------- */

async function init() {
  try {
    const response = await fetch('/api/bootstrap');
    if (!response.ok) throw new Error('bootstrap failed');

    const data = await response.json();
    settings = Object.assign(settings, data.settings || {});
    allProducts = data.products || [];
    allCategories = data.categories || [];

    applySettings();
    renderCategories();
    renderFilters();
    renderProducts();
    renderCart();

    /* Со страницы букета приходят с ?checkout=1 — сразу открываем оформление. */
    if (new URLSearchParams(location.search).get('checkout') === '1' && cart.length) {
      openCart();
      showCheckout();
      history.replaceState(null, '', location.pathname);
    }
  } catch (e) {
    $('#productGrid').innerHTML = '<div class="loading">Не удалось загрузить каталог. Проверьте, что сервер запущен.</div>';
  }
}

$('#cartBtn').addEventListener('click', openCart);
$('#closeCart').addEventListener('click', closeCart);
$('#cartOverlay').addEventListener('click', closeCart);
$('#checkoutBtn').addEventListener('click', checkout);
$('#backToCart').addEventListener('click', showCart);
$('#checkoutView').addEventListener('submit', submitOrder);
$('#fCity').addEventListener('change', syncDeliveryFields);
document.querySelectorAll('input[name="delivery"]').forEach(radio => {
  radio.addEventListener('change', syncDeliveryFields);
});
/* Вторая кнопка вела прямо в WhatsApp мимо формы — заказ уходил без адреса.
   Теперь она открывает то же оформление: в WhatsApp попадём следующим шагом. */
$('#cartWhatsApp').addEventListener('click', event => {
  event.preventDefault();
  checkout();
});

$('#searchBtn').addEventListener('click', () => {
  $('#searchDrawer').classList.add('open');
  $('#searchDrawer').setAttribute('aria-hidden', 'false');
  $('#searchInput').focus();
});

$('#closeSearch').addEventListener('click', () => {
  $('#searchDrawer').classList.remove('open');
  $('#searchDrawer').setAttribute('aria-hidden', 'true');
});

$('#searchInput').addEventListener('input', renderProducts);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeCart();
    $('#searchDrawer').classList.remove('open');
  }
});

init();

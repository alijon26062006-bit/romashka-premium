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

function waUrl(text = 'Здравствуйте! Хочу узнать подробнее о букетах магазина ' + (settings.shopName || 'Ромашка') + ' 🌸') {
  return 'https://wa.me/' + settings.whatsapp + '?text=' + encodeURIComponent(text);
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

  const lines = items.map(i => `• ${i.product.name} × ${i.qty} — ${money(i.product.price * i.qty)}`).join('\n');
  $('#cartWhatsApp').href = waUrl('Здравствуйте! 🌸 Хочу оформить заказ:\n' + lines + '\nИтого: ' + money(total) + '\nПодскажите, пожалуйста, как оформить доставку?');
}

function openCart() {
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

/* Заявка уходит на сервер до перехода в WhatsApp — владелец видит все обращения. */
function logOrder() {
  const items = cart.map(i => ({ id: i.id, qty: i.qty }));
  if (!items.length) return;
  try {
    fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      keepalive: true
    }).catch(() => {});
  } catch (e) { /* заказ всё равно уйдёт в WhatsApp */ }
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

  const items = cartDetails();
  const total = items.reduce((s, i) => s + i.qty * i.product.price, 0);
  const lines = items.map(i => `${i.product.name} × ${i.qty}`).join(', ');

  logOrder();
  location.href = waUrl(`Здравствуйте! 🌸 Хочу оформить заказ в магазине «${settings.shopName}».\n\n${lines}\nИтого: ${money(total)}\n\nПодскажите, пожалуйста, как оформить доставку?`);
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
  } catch (e) {
    $('#productGrid').innerHTML = '<div class="loading">Не удалось загрузить каталог. Проверьте, что сервер запущен.</div>';
  }
}

$('#cartBtn').addEventListener('click', openCart);
$('#closeCart').addEventListener('click', closeCart);
$('#cartOverlay').addEventListener('click', closeCart);
$('#checkoutBtn').addEventListener('click', checkout);
$('#cartWhatsApp').addEventListener('click', logOrder);

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

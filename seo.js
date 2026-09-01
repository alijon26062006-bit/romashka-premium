/* ==========================================================================
   Ромашка Premium — SEO

   Здесь собрано всё, что видит поисковик: заголовки страниц, описания,
   адреса товаров и разметка Schema.org. Вынесено отдельно, потому что
   правила тут свои — длина заголовка, падежи, ключевые слова, — и в
   server.js они только мешали бы читать логику.

   Главная мысль: заголовок должен начинаться с того, что человек набирает
   в поиске. «Доставка цветов в Душанбе — Ромашка» находится по запросу
   «доставка цветов душанбе», а «Ромашка — цветы с любовью» не находится
   ни по чему, кроме названия, которого никто не знает.
   ========================================================================== */

/* Google обрезает заголовок примерно на 60 знаках, описание — на 160. */
const TITLE_LIMIT = 62;
const DESCRIPTION_LIMIT = 160;

/* Описание по умолчанию из первых версий. Оно одинаковое у всех установок и
   ничего не говорит про цены и каталог, поэтому считаем его «не заданным»
   и собираем описание сами. Своё описание владельца, конечно, уважаем. */
const LEGACY_META = 'Ромашка — цветочный магазин в Душанбе. Свежие букеты, композиции и доставка.';

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

/* «Нежная ромашка» → nezhnaya-romashka. Адрес с названием букета понятнее
   человеку в выдаче и в пересланной ссылке, чем product.html?id=17. */
function slug(text) {
  const latin = String(text || '')
    .toLowerCase()
    .split('')
    .map(ch => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('');

  return latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/* «Душанбе» → «в Душанбе», «Худжанд» → «в Худжанде», «Исфара» → «в Исфаре».
   Заголовок с неправильным падежом читается как машинный перевод. */
function inCity(city) {
  const name = String(city || '').trim();
  if (!name) return '';

  const last = name.slice(-1).toLowerCase();
  if (last === 'а' || last === 'я') return name.slice(0, -1) + 'е';
  if ('еиоуыэю'.indexOf(last) !== -1) return name;
  if (last === 'ь' || last === 'й') return name.slice(0, -1) + 'е';
  return name + 'е';
}

function productPath(product) {
  const name = slug(product.name);
  return '/bukety/' + product.id + (name ? '-' + name : '');
}

function prices(products) {
  const values = products
    .filter(p => p.available && Number(p.price) > 0)
    .map(p => Number(p.price));

  if (!values.length) return null;
  return { min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
}

function trim(text, limit) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;

  /* Режем по слову, а не по букве: обрубок посреди слова выглядит небрежно. */
  const cut = clean.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;–—-]$/, '') + '…';
}

/* --------------------------------------------------------------------------
   Заголовки и описания
   -------------------------------------------------------------------------- */

function homeTitle(settings, products) {
  const shop = settings.shopName || 'Ромашка';
  const city = inCity(settings.city);
  const range = prices(products);

  const base = 'Доставка цветов' + (city ? ' в ' + city : '') + ' — ' + shop;
  if (range) {
    const withPrice = base + ' | Букеты от ' + range.min + ' ' + (settings.currency || '');
    if (withPrice.trim().length <= TITLE_LIMIT) return withPrice.trim();
  }

  return base;
}

function homeDescription(settings, products) {
  const own = String(settings.metaDescription || '').trim();
  if (own && own !== LEGACY_META) return trim(own, DESCRIPTION_LIMIT);

  const city = inCity(settings.city);
  const range = prices(products);
  const count = products.filter(p => p.available).length;

  const parts = ['Свежие букеты, розы и композиции' + (city ? ' с доставкой в ' + city : '') + '.'];
  if (count) parts.push(count + ' ' + bouquets(count) + ' в каталоге' + (range ? ', цены от ' + range.min + ' ' + (settings.currency || '') : '') + '.');
  parts.push('Заказ в WhatsApp за минуту.');

  return trim(parts.join(' '), DESCRIPTION_LIMIT);
}

function bouquets(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'букет';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'букета';
  return 'букетов';
}

function homeHeading(settings) {
  const city = inCity(settings.city);
  return city
    ? '<h1>Цветы с доставкой<br><em>в ' + city + ' ♡</em></h1>'
    : '<h1>Дарите эмоции<br><em>с любовью ♡</em></h1>';
}

function productTitle(product, settings) {
  const city = inCity(settings.city);
  const price = product.price + ' ' + (settings.currency || '');

  const base = product.name + ' — ' + price;
  const withCity = city ? base + ', доставка в ' + city : base;
  if (withCity.length <= TITLE_LIMIT) return withCity;

  return trim(base, TITLE_LIMIT);
}

function productDescription(product, settings) {
  const city = inCity(settings.city);
  const details = product.description || product.composition || '';

  const parts = [product.name + ' — ' + product.price + ' ' + (settings.currency || '') + '.'];
  if (details) parts.push(details);
  parts.push('Доставка' + (city ? ' в ' + city : '') + ', заказ в WhatsApp.');

  return trim(parts.join(' '), DESCRIPTION_LIMIT);
}

/* --------------------------------------------------------------------------
   Разметка Schema.org

   По ней Google строит расширенный сниппет: цену, наличие, адрес и часы
   работы прямо в выдаче. Для магазина это заметнее любого текста.
   -------------------------------------------------------------------------- */

/* «Ежедневно 08:00–22:00» → машиночитаемые часы работы. Если строка написана
   как-то иначе, часы просто не попадут в разметку — это не ошибка. */
function openingHours(hours) {
  const match = /(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/.exec(String(hours || ''));
  if (!match) return null;

  const pad = v => String(v).padStart(2, '0');

  return {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: pad(match[1]) + ':' + match[2],
    closes: pad(match[3]) + ':' + match[4]
  };
}

function shopNode(settings, products, base, image) {
  const range = prices(products);
  const hours = openingHours(settings.hours);
  const links = [settings.instagram, settings.telegram].filter(Boolean);

  const node = {
    '@type': 'Florist',
    '@id': base + '/#shop',
    name: settings.shopName,
    url: base + '/',
    inLanguage: 'ru-RU'
  };

  if (image) node.image = image;
  if (settings.phone) node.telephone = settings.phone;
  if (range) node.priceRange = range.min + '–' + range.max + ' ' + (settings.currency || '');
  if (hours) node.openingHoursSpecification = hours;
  if (links.length) node.sameAs = links;
  if (settings.city) node.areaServed = { '@type': 'City', name: settings.city };

  node.address = {
    '@type': 'PostalAddress',
    addressLocality: settings.city || undefined,
    streetAddress: settings.address || undefined,
    addressCountry: 'TJ'
  };

  node.currenciesAccepted = 'TJS';
  return node;
}

function homeJsonLd(settings, products, base, image) {
  const graph = [
    {
      '@type': 'WebSite',
      '@id': base + '/#website',
      url: base + '/',
      name: settings.shopName,
      inLanguage: 'ru-RU',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: base + '/?q={search_term_string}' },
        'query-input': 'required name=search_term_string'
      }
    },
    shopNode(settings, products, base, image)
  ];

  const listed = products.filter(p => p.available).slice(0, 12);
  if (listed.length) {
    graph.push({
      '@type': 'ItemList',
      '@id': base + '/#catalog',
      name: 'Каталог букетов',
      numberOfItems: listed.length,
      itemListElement: listed.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: p.name,
        url: base + productPath(p)
      }))
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

function productJsonLd(product, settings, base, images) {
  const url = base + productPath(product);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        '@id': url + '#product',
        name: product.name,
        description: productDescription(product, settings),
        image: images,
        sku: String(product.id),
        category: product.category,
        url,
        brand: { '@type': 'Brand', name: settings.shopName },
        offers: {
          '@type': 'Offer',
          url,
          price: product.price,
          priceCurrency: 'TJS',
          availability: product.available
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          seller: { '@id': base + '/#shop' }
        }
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Главная', item: base + '/' },
          { '@type': 'ListItem', position: 2, name: product.category, item: base + '/?category=' + encodeURIComponent(product.category) },
          { '@type': 'ListItem', position: 3, name: product.name, item: url }
        ]
      }
    ]
  };
}

module.exports = {
  slug,
  inCity,
  productPath,
  homeTitle,
  homeDescription,
  homeHeading,
  productTitle,
  productDescription,
  homeJsonLd,
  productJsonLd,
  openingHours,
  TITLE_LIMIT,
  DESCRIPTION_LIMIT
};

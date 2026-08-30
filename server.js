const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const SHOP_NAME = 'Ромашка';
const WHATSAPP_NUMBER = '+992901403263'; // <-- ЗАМЕНИ на реальный номер
const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'admin123';

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'products.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const initialProducts = [
  {
    id: 1,
    name: 'Нежная ромашка',
    category: 'Ромашки',
    price: 120,
    description: 'Воздушный букет из свежих ромашек. Лёгкий, тёплый и очень нежный подарок для близкого человека.',
    composition: 'Ромашки, декоративная зелень, упаковка',
    size: 'Средний',
    image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?auto=format&fit=crop&w=1200&q=88',
    available: true
  },
  {
    id: 2,
    name: 'Розовая мечта',
    category: 'Розы',
    price: 280,
    description: 'Элегантная композиция из нежно-розовых роз для романтичного и красивого подарка.',
    composition: 'Розовые розы, зелень, дизайнерская упаковка',
    size: 'Средний',
    image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1200&q=88',
    available: true
  },
  {
    id: 3,
    name: 'Белая классика',
    category: 'Букеты',
    price: 240,
    description: 'Минималистичный светлый букет, который подойдёт для дня рождения, встречи или важного события.',
    composition: 'Белые цветы, эвкалипт, зелень',
    size: 'Средний',
    image: 'https://images.unsplash.com/photo-1523438885200-e635ba2c371e?auto=format&fit=crop&w=1200&q=88',
    available: true
  },
  {
    id: 4,
    name: 'Весенний сад',
    category: 'Букеты',
    price: 320,
    description: 'Яркая сезонная композиция с живой зеленью и лёгким весенним настроением.',
    composition: 'Сезонные цветы, зелень, лента',
    size: 'Большой',
    image: 'https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=1200&q=88',
    available: true
  },
  {
    id: 5,
    name: 'Любовь',
    category: 'Розы',
    price: 450,
    description: 'Большой букет красных роз — классический романтический подарок для особенного человека.',
    composition: 'Красные розы, зелень, премиальная упаковка',
    size: 'Большой',
    image: 'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?auto=format&fit=crop&w=1200&q=88',
    available: true
  },
  {
    id: 6,
    name: 'Лавандовое утро',
    category: 'Композиции',
    price: 210,
    description: 'Спокойная композиция в натуральных оттенках. Идеальна для уютного подарка без повода.',
    composition: 'Лаванда, сухоцветы, декоративная зелень',
    size: 'Небольшой',
    image: 'https://images.unsplash.com/photo-1495231916356-a86217efff12?auto=format&fit=crop&w=1200&q=88',
    available: true
  }
];

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(initialProducts, null, 2), 'utf8');
}

function readProducts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialProducts, null, 2), 'utf8');
    return initialProducts;
  }
}

function writeProducts(products) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2), 'utf8');
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = Date.now() + '-' + Math.random().toString(36).slice(2, 10) + ext;
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Только JPG, PNG и WEBP'));
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const split = decoded.indexOf(':');
  const user = split >= 0 ? decoded.slice(0, split) : decoded;
  const pass = split >= 0 ? decoded.slice(split + 1) : '';

  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  next();
}

app.get('/api/config', function (req, res) {
  res.json({ shopName: SHOP_NAME, whatsapp: WHATSAPP_NUMBER });
});

app.get('/api/products', function (req, res) {
  res.json(readProducts());
});

app.post('/api/admin/login', function (req, res) {
  if (req.body.username === ADMIN_USER && req.body.password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Неверный логин или пароль' });
});

app.post('/api/products', auth, upload.single('image'), function (req, res) {
  try {
    const products = readProducts();
    const product = {
      id: Date.now(),
      name: req.body.name || 'Без названия',
      category: req.body.category || 'Букеты',
      price: Number(req.body.price) || 0,
      description: req.body.description || '',
      composition: req.body.composition || '',
      size: req.body.size || '',
      image: req.file ? '/uploads/' + req.file.filename : (req.body.image || ''),
      available: req.body.available !== 'false'
    };
    products.unshift(product);
    writeProducts(products);
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка добавления товара' });
  }
});

app.put('/api/products/:id', auth, upload.single('image'), function (req, res) {
  try {
    const id = Number(req.params.id);
    const products = readProducts();
    const index = products.findIndex(p => p.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    const old = products[index];
    const product = {
      ...old,
      name: req.body.name !== undefined ? req.body.name : old.name,
      category: req.body.category !== undefined ? req.body.category : old.category,
      price: req.body.price !== undefined ? Number(req.body.price) : old.price,
      description: req.body.description !== undefined ? req.body.description : old.description,
      composition: req.body.composition !== undefined ? req.body.composition : old.composition,
      size: req.body.size !== undefined ? req.body.size : old.size,
      available: req.body.available !== undefined ? req.body.available !== 'false' : old.available
    };

    if (req.file) {
      product.image = '/uploads/' + req.file.filename;
    } else if (req.body.image) {
      product.image = req.body.image;
    }

    products[index] = product;
    writeProducts(products);
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка изменения товара' });
  }
});

app.delete('/api/products/:id', auth, function (req, res) {
  try {
    const id = Number(req.params.id);
    const products = readProducts();
    const filtered = products.filter(p => p.id !== id);

    if (filtered.length === products.length) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    writeProducts(filtered);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления товара' });
  }
});

app.use(function (error, req, res, next) {
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  next();
});

// Express 5 compatible fallback — без app.get('*')
app.use(function (req, res) {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.listen(PORT, function () {
  console.log('');
  console.log('==========================================');
  console.log('🌼 РОМАШКА PREMIUM');
  console.log('🌐 http://localhost:' + PORT);
  console.log('🔐 http://localhost:' + PORT + '/admin.html');
  console.log('==========================================');
});

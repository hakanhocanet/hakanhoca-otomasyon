// HakanHoca Otomasyon - Instagram Yorum -> DM Sistemi (Panel'li versiyon)
// Yorum geldiğinde anahtar kelime eşleşirse ANINDA özel mesaj gönderilir.
// Yönetim telefondan /admin adresinden yapılır, GitHub'a hiç gerek yoktur.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'hakanhoca_dogrulama_kelimesi';
const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID; // Instagram business hesabının ID'si
const ADMIN_USER = process.env.ADMIN_USER || 'hakanhoca';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'degistir123';

// GitHub'a otomatik kaydetme (panel değişiklikleri kalıcı olsun diye - restart sonrası kaybolmasın)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // örn: "hakanhocanet/hakanhoca-otomasyon"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ---- Basit dosya tabanlı veri saklama ----
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { sent: [], failed: [], retryQueue: [], replyCounters: {} };
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.replyCounters) data.replyCounters = {};
  return data;
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { posts: {} };
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
function saveConfigLocal(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ---- GitHub'a config.json'ı kaydet (kalıcı olması için) ----
async function saveConfigToGithub(config) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log('GitHub bağlantısı ayarlanmamış, sadece yerel diske kaydedildi.');
    return;
  }
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/config.json`;

    // Önce mevcut dosyanın sha'sını al (güncelleme için gerekli)
    const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    });
    const getData = await getRes.json();
    const sha = getData.sha;

    const content = Buffer.from(JSON.stringify(config, null, 2)).toString('base64');

    await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Panel üzerinden otomasyon güncellendi',
        content,
        sha,
        branch: GITHUB_BRANCH,
      }),
    });
    console.log('config.json GitHub\'a kaydedildi.');
  } catch (err) {
    console.error('GitHub kaydetme hatası:', err.message);
  }
}

// ================== WEBHOOK (Instagram tarafı) ==================

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === 'comments') {
          await handleComment(change.value);
        }
      }
    }
  } catch (err) {
    console.error('Webhook işleme hatası:', err);
  }
});

async function handleComment(value) {
  const commentId = value.id;
  const commentText = (value.text || '').toLowerCase().trim();
  const mediaId = value.media ? value.media.id : null;
  const fromUsername = value.from ? value.from.username : 'bilinmiyor';

  const config = loadConfig();
  const postConfig = mediaId ? config.posts[mediaId] : null;

  const record = {
    commentId, mediaId, fromUsername,
    commentText: value.text || '',
    timestamp: new Date().toISOString(),
  };

  if (!postConfig) {
    // Bu gönderi için otomasyon tanımlı değil - bu normal, hesaptaki her yorumu görüyoruz.
    // Hata olarak loglamaya gerek yok, sessizce geç.
    return;
  }

  const keyword = postConfig.keyword.toLowerCase();
  if (!commentText.includes(keyword)) return; // ilgisiz yorum, sessizce geç

  const message = postConfig.replyMessage ||
    `Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: ${postConfig.link}`;

  await attemptSend(commentId, message, { ...record, postTitle: postConfig.title || '', mediaId });

  // Herkese açık yorum cevabı da gönder (varsa) - dönüşümlü, hep aynısı olmasın
  if (postConfig.publicReplies && postConfig.publicReplies.length > 0) {
    const publicText = pickNextPublicReply(mediaId, postConfig.publicReplies);
    await sendPublicReply(commentId, publicText);
  }
}

// Sırayla, hep aynı cevabı art arda kullanmadan bir sonraki metni seç
function pickNextPublicReply(mediaId, replies) {
  const data = loadData();
  const currentIndex = data.replyCounters[mediaId] || 0;
  const nextIndex = (currentIndex + 1) % replies.length;
  data.replyCounters[mediaId] = nextIndex;
  saveData(data);
  return replies[currentIndex % replies.length];
}

// Yorumun altına herkese görünecek şekilde cevap yaz
async function sendPublicReply(commentId, text) {
  try {
    const response = await fetch(
      `https://graph.instagram.com/v23.0/${commentId}/replies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: ACCESS_TOKEN }),
      }
    );
    const result = await response.json();
    if (!response.ok || result.error) {
      console.error('Herkese açık cevap gönderilemedi:', result.error ? result.error.message : 'bilinmeyen hata');
    }
  } catch (err) {
    console.error('Herkese açık cevap bağlantı hatası:', err.message);
  }
}

async function attemptSend(commentId, message, record) {
  try {
    const response = await fetch(
      `https://graph.instagram.com/v23.0/${commentId}/private_replies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, access_token: ACCESS_TOKEN }),
      }
    );
    const result = await response.json();

    if (response.ok && !result.error) {
      logSent(record);
      console.log(`✅ DM gönderildi: @${record.fromUsername}`);
    } else {
      const errorMsg = result.error ? result.error.message : 'Bilinmeyen hata';
      const errorCode = result.error ? result.error.code : null;
      if (errorCode === 4 || errorCode === 17 || errorCode === 32) {
        addToRetryQueue(commentId, message, record);
        logFailed({ ...record, reason: `Limit doldu, tekrar denenecek: ${errorMsg}` });
      } else {
        logFailed({ ...record, reason: errorMsg });
      }
    }
  } catch (err) {
    logFailed({ ...record, reason: `Bağlantı hatası: ${err.message}` });
  }
}

function logSent(record) {
  const data = loadData();
  data.sent.push({ ...record, sentAt: new Date().toISOString() });
  saveData(data);
}
function logFailed(record) {
  const data = loadData();
  data.failed.push(record);
  saveData(data);
}
function addToRetryQueue(commentId, message, record) {
  const data = loadData();
  data.retryQueue.push({ commentId, message, record, addedAt: new Date().toISOString() });
  saveData(data);
}

setInterval(async () => {
  const data = loadData();
  if (data.retryQueue.length === 0) return;
  const queue = [...data.retryQueue];
  data.retryQueue = [];
  saveData(data);
  for (const item of queue) {
    await attemptSend(item.commentId, item.message, item.record);
    await new Promise((r) => setTimeout(r, 2000));
  }
}, 30 * 60 * 1000);

// ================== ADMIN PANEL (telefon tarafı) ==================

// Basit şifre koruması
function checkAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Panel"');
    return res.status(401).send('Giriş gerekli');
  }
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Panel"');
  return res.status(401).send('Hatalı kullanıcı adı veya şifre');
}

app.use('/admin', checkAuth);

// Panel sayfasını göster
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Son Instagram gönderilerini getir
app.get('/admin/api/posts', async (req, res) => {
  try {
    const response = await fetch(
      `https://graph.instagram.com/v23.0/${IG_USER_ID}/media?fields=id,caption,permalink,media_url,thumbnail_url,timestamp,media_type&limit=20&access_token=${ACCESS_TOKEN}`
    );
    const result = await response.json();
    if (result.error) return res.status(500).json({ error: result.error.message });

    const config = loadConfig();
    const posts = (result.data || []).map((post) => ({
      ...post,
      automation: config.posts[post.id] || null,
    }));
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bir gönderi için otomasyon kaydet/güncelle
app.post('/admin/api/posts', async (req, res) => {
  const { mediaId, title, keyword, link, replyMessage, publicReplies } = req.body;
  if (!mediaId || !keyword || !link) {
    return res.status(400).json({ error: 'mediaId, keyword ve link zorunlu' });
  }
  const config = loadConfig();
  config.posts[mediaId] = {
    title: title || '',
    keyword,
    link,
    replyMessage: replyMessage || `Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: ${link}`,
    publicReplies: Array.isArray(publicReplies) ? publicReplies.filter((r) => r && r.trim()) : [],
  };
  saveConfigLocal(config);
  await saveConfigToGithub(config);
  res.json({ ok: true, config: config.posts[mediaId] });
});

// Bir gönderinin otomasyonunu sil
app.delete('/admin/api/posts/:mediaId', async (req, res) => {
  const config = loadConfig();
  delete config.posts[req.params.mediaId];
  saveConfigLocal(config);
  await saveConfigToGithub(config);
  res.json({ ok: true });
});

// Durum raporu
app.get('/admin/api/status', (req, res) => {
  const data = loadData();
  res.json({
    ozet: {
      basariylaGonderilen: data.sent.length,
      basarisizOlan: data.failed.length,
      tekrarDenenecek: data.retryQueue.length,
    },
    gonderilenler: data.sent.slice(-50).reverse(),
    basarisizOlanlar: data.failed.slice(-50).reverse(),
  });
});

app.get('/privacy', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head><meta charset="UTF-8"><title>Gizlilik Politikası - HakanHoca Otomasyon</title>
    <style>body{font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}</style>
    </head>
    <body>
      <h1>Gizlilik Politikası</h1>
      <p>HakanHoca Otomasyon, Instagram gönderilerine yapılan yorumları belirli anahtar kelimelere göre
      tespit ederek, ilgili kullanıcıya otomatik bir özel mesaj (DM) göndermek amacıyla çalışan bir
      otomasyon sistemidir.</p>

      <h2>Toplanan Veriler</h2>
      <p>Sistem yalnızca; yorum yapan kullanıcının Instagram kullanıcı adını, yorum metnini ve ilgili
      gönderi bilgisini işler. Bu veriler yalnızca otomatik yanıt gönderme amacıyla, geçici olarak
      sistem kayıtlarında (log) tutulur.</p>

      <h2>Verilerin Kullanımı</h2>
      <p>Toplanan veriler üçüncü taraflarla paylaşılmaz, satılmaz veya pazarlama amacıyla kullanılmaz.
      Sadece talep edilen materyalin ilgili kullanıcıya iletilmesi amacıyla kullanılır.</p>

      <h2>İletişim</h2>
      <p>Bu sistemle ilgili sorularınız için Instagram üzerinden hesap sahibiyle iletişime geçebilirsiniz.</p>
    </body>
    </html>
  `);
});

app.get('/', (req, res) => {
  res.send('HakanHoca Otomasyon çalışıyor. Panel için /admin adresine gidin.');
});

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});

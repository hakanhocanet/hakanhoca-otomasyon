// HakanHoca Otomasyon - Instagram Yorum -> DM Sistemi (Panel'li versiyon)
// Yorum geldiğinde anahtar kelime eşleşirse ANINDA özel mesaj gönderilir.
// Yönetim telefondan /admin adresinden yapılır, GitHub'a hiç gerek yoktur.
//
// GÜNCELLEME (Instagram Login sistemine geçiş):
// - Mesaj gönderme ve yorum cevaplama artık graph.facebook.com yerine
//   graph.instagram.com üzerinden, Instagram Login ile alınan access token ile yapılıyor.
// - Access token artık otomatik olarak kendini yeniliyor (60 günlük ömrü dolmadan önce),
//   böylece elle token yenileme işine bir daha hiç gerek kalmıyor.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'hakanhoca_dogrulama_kelimesi';
const IG_USER_ID = process.env.IG_USER_ID; // Instagram business hesabının ID'si
const ADMIN_USER = process.env.ADMIN_USER || 'hakanhoca';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'degistir123';

// Instagram API sürümü ve temel adres (Instagram Login sistemi - Facebook Login değil)
const IG_GRAPH_BASE = 'https://graph.instagram.com/v23.0';

// ---- Access token: bellekte tutulan, otomatik yenilenen değişken ----
// Başlangıçta Render'daki IG_ACCESS_TOKEN ortam değişkeninden okunur.
// Sunucu çalışırken otomatik yenilendikçe bu değişken güncellenir.
let igAccessToken = process.env.IG_ACCESS_TOKEN;

// Token'ı kalıcı olarak Render'ın ortam değişkenine de yazmak için (opsiyonel ama önerilir).
// Bu ikisi ayarlanmazsa, yenileme yine çalışır ama sadece sunucu yeniden başlamadığı sürece geçerli olur.
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID;

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
  if (!fs.existsSync(CONFIG_FILE)) return { posts: {}, pendingTemplates: {}, tokenRefreshedAt: null };
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (!config.pendingTemplates) config.pendingTemplates = {};
  if (!config.tokenRefreshedAt) config.tokenRefreshedAt = null;
  return config;
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

// ================== ACCESS TOKEN OTOMATİK YENİLEME ==================
// Instagram Login token'ları 60 gün geçerli. Süresi dolmadan önce (ve en az
// 24 saat kullanıldıktan sonra) yenilenebilir.
//
// ÖNEMLİ: setInterval'a doğrudan "45 gün" gibi büyük bir milisaniye değeri
// VERİLEMEZ - Node.js/JavaScript'in zamanlayıcıları 32-bit sayı ile sınırlı
// (maksimum ~24.8 gün). Daha büyük bir değer verilirse, sistem bunu "1 milisaniye"
// olarak yorumlar ve fonksiyon saniyede binlerce kez tetiklenir! Bu yüzden burada
// GÜVENLİ bir şekilde her 24 saatte bir "vakti geldi mi" diye kontrol ediyoruz,
// gerçek yenileme sadece 45 gün dolduğunda tetikleniyor.

// ÖNEMLİ (2. düzeltme): "son yenileme zamanı" artık sadece bellekte değil, config.json
// içinde KALICI olarak tutuluyor (GitHub'a da kaydediliyor). Çünkü Render bu uygulamayı
// çok sık yeniden başlatıyor (panelden her kayıt yeni bir deploy tetikliyor, ayrıca ücretsiz
// plan uzun süre istek gelmeyince kendini tamamen kapatıp bir sonraki istekte yeniden açıyor).
// Eğer bu zaman sadece bellekte tutulsaydı, her yeniden başlamada "az önce yenilendi" sanılır
// ve 45 günlük sayaç hiçbir zaman gerçekten dolamayabilirdi - yani otomatik yenileme hiç
// tetiklenmeyebilirdi. Şimdi gerçek son yenileme zamanı diskte/GitHub'da saklandığı için,
// uygulama kaç kere yeniden başlarsa başlasın doğru zamanı hatırlıyor.
let sonTokenYenilemeZamani = (function () {
  const config = loadConfig();
  return config.tokenRefreshedAt || Date.now();
})();

async function refreshAccessToken() {
  if (!igAccessToken) {
    console.log('IG_ACCESS_TOKEN ayarlanmamış, token yenileme atlanıyor.');
    return;
  }
  try {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${igAccessToken}`
    );
    const result = await res.json();

    if (result.access_token) {
      igAccessToken = result.access_token;
      sonTokenYenilemeZamani = Date.now();

      // Gerçek yenileme zamanını kalıcı olarak kaydet (bellek + disk + GitHub).
      const config = loadConfig();
      config.tokenRefreshedAt = sonTokenYenilemeZamani;
      saveConfigLocal(config);
      await saveConfigToGithub(config);

      const gunSayisi = Math.round((result.expires_in || 0) / 86400);
      console.log(`✅ Instagram access token yenilendi. Yeni geçerlilik: ~${gunSayisi} gün.`);
      await persistTokenToRender(igAccessToken);
    } else {
      console.error('⚠️ Token yenileme başarısız oldu:', result.error ? result.error.message : result);
    }
  } catch (err) {
    console.error('⚠️ Token yenileme sırasında bağlantı hatası:', err.message);
  }
}

// Yenilenen token'ı Render'ın ortam değişkenine kalıcı olarak yazar.
// Bu sayede sunucu yeniden başlasa (deploy, restart vb.) bile en güncel token kullanılır.
// RENDER_API_KEY ve RENDER_SERVICE_ID ayarlanmadıysa bu adım sessizce atlanır
// (token yine de bellekte güncel kalır, sadece bir sonraki tam restart'ta eskisine döner).
async function persistTokenToRender(token) {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) {
    console.log('RENDER_API_KEY / RENDER_SERVICE_ID ayarlanmamış, token sadece bellekte güncellendi.');
    return;
  }
  try {
    const res = await fetch(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars/IG_ACCESS_TOKEN`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${RENDER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: token }),
      }
    );
    if (res.ok) {
      console.log('✅ Yeni token Render ortam değişkenine kalıcı olarak kaydedildi.');
    } else {
      const errText = await res.text();
      console.error('⚠️ Render ortam değişkeni güncellenemedi:', res.status, errText);
    }
  } catch (err) {
    console.error('⚠️ Render API bağlantı hatası:', err.message);
  }
}

// Gerçek yenileme zamanı gelip gelmediğini kontrol eder. Bu fonksiyon her gün
// (24 saatte bir) çalışır ama Meta'ya sadece 45 gün dolduğunda istek atar -
// böylece sunucu her yeniden başladığında (Render sık sık redeploy ediyor)
// Meta'nın API'sine gereksiz/aşırı istek gitmez.
const YENILEME_ARALIGI_MS = 45 * 24 * 60 * 60 * 1000; // 45 gün (sadece karşılaştırma için, setInterval'a VERİLMİYOR)

function refreshAccessTokenIfDue() {
  const gecenSure = Date.now() - sonTokenYenilemeZamani;
  if (gecenSure >= YENILEME_ARALIGI_MS) {
    refreshAccessToken();
  } else {
    const kalanGun = Math.ceil((YENILEME_ARALIGI_MS - gecenSure) / (24 * 60 * 60 * 1000));
    console.log(`Token yenileme vakti henüz gelmedi (~${kalanGun} gün kaldı).`);
  }
}

// Uygulama her açıldığında bir kez kontrol et (artık zaman kalıcı olarak saklandığı için
// bu güvenli - sık sık yeniden başlasa bile Meta'ya gereksiz istek gitmiyor, sadece
// gerçekten 45 gün dolmuşsa istek atılıyor). Sonra her 24 saatte bir tekrar kontrol et
// (24 saat = 86.400.000 ms, 32-bit zamanlayıcı sınırının çok altında, bu yüzden güvenli).
refreshAccessTokenIfDue();
setInterval(refreshAccessTokenIfDue, 24 * 60 * 60 * 1000);

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

// Bir gönderi otomasyonu için gönderilecek son mesaj metnini oluşturur.
// ÖNEMLİ DÜZELTME: Panelde kendi mesaj metnini yazan (ve linki metnin içine
// eklemeyi unutan) kullanıcılar için - link alanı dolu olduğu halde mesaj
// metninde o link geçmiyorsa, link otomatik olarak mesajın sonuna eklenir.
// Böylece "mesaj gitti ama link hiç gitmedi" durumu bir daha yaşanmaz.
function buildMessage(postConfig) {
  const link = (postConfig.link || '').trim();
  let message = (postConfig.replyMessage && postConfig.replyMessage.trim())
    ? postConfig.replyMessage.trim()
    : `Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: ${link}`;

  if (link && !message.includes(link)) {
    message = `${message}\n\n${link}`;
  }
  return message;
}

async function handleComment(value) {
  const commentId = value.id;
  const commentText = (value.text || '').toLowerCase().trim();
  const mediaId = value.media ? value.media.id : null;
  const fromUsername = value.from ? value.from.username : 'bilinmiyor';

  const config = loadConfig();
  let postConfig = mediaId ? config.posts[mediaId] : null;

  const record = {
    commentId, mediaId, fromUsername,
    commentText: value.text || '',
    timestamp: new Date().toISOString(),
  };

  // Bu gönderi için henüz özel bir otomasyon yoksa, "Planlanan" (henüz paylaşılmamışken
  // hazırlanmış) otomasyonlardan anahtar kelimesi bu yorumla eşleşen var mı diye bak.
  // Eşleşme bulunursa, o taslak artık kalıcı olarak bu gerçek gönderiye bağlanır.
  if (!postConfig && mediaId) {
    const pending = config.pendingTemplates || {};
    for (const pendingId of Object.keys(pending)) {
      const template = pending[pendingId];
      if (template.keyword && commentText.includes(template.keyword.toLowerCase())) {
        postConfig = { ...template };
        config.posts[mediaId] = postConfig;
        delete config.pendingTemplates[pendingId];
        saveConfigLocal(config);
        saveConfigToGithub(config).catch((err) =>
          console.error('Planlanan otomasyon bağlanırken GitHub kayıt hatası:', err.message)
        );
        console.log(`📌 Planlanan otomasyon ("${template.title || template.keyword}") gönderi ${mediaId} için bağlandı.`);
        break;
      }
    }
  }

  if (!postConfig) {
    // Bu gönderi için otomasyon tanımlı değil - bu normal, hesaptaki her yorumu görüyoruz.
    // Hata olarak loglamaya gerek yok, sessizce geç.
    return;
  }

  const keyword = postConfig.keyword.toLowerCase();
  if (!commentText.includes(keyword)) return; // ilgisiz yorum, sessizce geç

  const message = buildMessage(postConfig);

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
      `${IG_GRAPH_BASE}/${commentId}/replies?access_token=${igAccessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
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

// Yoruma özel mesaj (DM) gönder - Instagram Login / graph.instagram.com üzerinden
async function attemptSend(commentId, message, record) {
  try {
    const response = await fetch(
      `${IG_GRAPH_BASE}/${IG_USER_ID}/messages?access_token=${igAccessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { comment_id: commentId },
          message: { text: message },
        }),
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
      `${IG_GRAPH_BASE}/${IG_USER_ID}/media?fields=id,caption,permalink,media_url,thumbnail_url,timestamp,media_type&limit=20&access_token=${igAccessToken}`
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

// ================== PLANLANAN OTOMASYONLAR (henüz paylaşılmamış gönderiler için) ==================
// Bir gönderiyi paylaşmadan önce otomasyonunu "taslak" olarak kaydedebilirsin.
// Gönderi paylaşılıp o anahtar kelimeyle ilk yorum geldiğinde, sistem bu taslağı otomatik
// olarak gerçek gönderiye bağlar (bkz. handleComment() içindeki eşleştirme mantığı).

app.get('/admin/api/pending', (req, res) => {
  const config = loadConfig();
  res.json({ pending: config.pendingTemplates });
});

app.post('/admin/api/pending', async (req, res) => {
  const { title, keyword, link, replyMessage, publicReplies } = req.body;
  if (!keyword || !link) {
    return res.status(400).json({ error: 'Anahtar kelime ve link zorunlu' });
  }
  const config = loadConfig();
  const id = 'p_' + Date.now();
  config.pendingTemplates[id] = {
    title: title || '',
    keyword,
    link,
    replyMessage: replyMessage || `Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: ${link}`,
    publicReplies: Array.isArray(publicReplies) ? publicReplies.filter((r) => r && r.trim()) : [],
  };
  saveConfigLocal(config);
  await saveConfigToGithub(config);
  res.json({ ok: true, id });
});

app.delete('/admin/api/pending/:id', async (req, res) => {
  const config = loadConfig();
  delete config.pendingTemplates[req.params.id];
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

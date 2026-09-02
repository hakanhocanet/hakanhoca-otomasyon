// HakanHoca Otomasyon - Instagram Yorum -> DM Sistemi
// Mantık: Yorum geldiği an, hangi gönderiye ait olduğuna bakılır,
// anahtar kelime eşleşirse ANINDA özel mesaj gönderilir.
// Başarısız olanlar (limit doldu, engellenmiş, vs.) ayrı listede tutulur ve otomatik tekrar denenir.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'hakanhoca_dogrulama_kelimesi';
const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN; // Instagram access token (Render'da env variable olarak eklenecek)

const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ---- Basit dosya tabanlı veri saklama ----
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { sent: [], failed: [], retryQueue: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { posts: {} };
    // Örnek yapı:
    // posts: {
    //   "17895...mediaId...": { keyword: "PDF", link: "https://hakanhoca.net/problem", title: "3. Sınıf Matematik" }
    // }
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

// ---- Webhook doğrulama (Meta ilk bağlantıda bunu çağırır) ----
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook doğrulandı.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---- Yorum geldiğinde buraya düşer ----
app.post('/webhook', async (req, res) => {
  // Meta'ya hemen 200 dönmemiz gerekiyor (yoksa tekrar tekrar gönderir)
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

// ---- Bir yorumu işle: anahtar kelime kontrolü + anlık DM ----
async function handleComment(value) {
  const commentId = value.id;
  const commentText = (value.text || '').toLowerCase().trim();
  const mediaId = value.media ? value.media.id : null;
  const fromUsername = value.from ? value.from.username : 'bilinmiyor';

  const config = loadConfig();
  const postConfig = mediaId ? config.posts[mediaId] : null;

  const record = {
    commentId,
    mediaId,
    fromUsername,
    commentText: value.text || '',
    timestamp: new Date().toISOString(),
  };

  // Bu gönderi için otomasyon tanımlı mı?
  if (!postConfig) {
    logFailed({ ...record, reason: 'Bu gönderi için otomasyon tanımlanmamış' });
    return;
  }

  // Anahtar kelime eşleşiyor mu?
  const keyword = postConfig.keyword.toLowerCase();
  if (!commentText.includes(keyword)) {
    // Anahtar kelime yok, bu yorum bizim ilgi alanımız değil - sessizce geç
    return;
  }

  // Eşleşti -> ANINDA DM göndermeyi dene
  const message = postConfig.replyMessage ||
    `Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: ${postConfig.link}`;

  await attemptSend(commentId, message, { ...record, postTitle: postConfig.title || '' });
}

// ---- Gönderme denemesi (anlık) ----
async function attemptSend(commentId, message, record) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v23.0/${commentId}/private_replies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          access_token: ACCESS_TOKEN,
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

      // Saatlik limit dolduysa (rate limit) tekrar deneme kuyruğuna al
      if (errorCode === 4 || errorCode === 17 || errorCode === 32) {
        addToRetryQueue(commentId, message, record);
        logFailed({ ...record, reason: `Limit doldu, tekrar denenecek: ${errorMsg}` });
      } else {
        // 7 gün geçmiş, kullanıcı engellemiş vs. -> kalıcı başarısız
        logFailed({ ...record, reason: errorMsg });
      }
    }
  } catch (err) {
    logFailed({ ...record, reason: `Bağlantı hatası: ${err.message}` });
  }
}

// ---- Kayıt fonksiyonları ----
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

// ---- Her 30 dakikada bir, limit yüzünden bekleyenleri tekrar dene ----
setInterval(async () => {
  const data = loadData();
  if (data.retryQueue.length === 0) return;

  console.log(`Tekrar deneniyor: ${data.retryQueue.length} yorum`);
  const queue = [...data.retryQueue];
  data.retryQueue = [];
  saveData(data);

  for (const item of queue) {
    await attemptSend(item.commentId, item.message, item.record);
    await new Promise((r) => setTimeout(r, 2000)); // API'yi yormamak için aralık
  }
}, 30 * 60 * 1000);

// ---- Basit durum/rapor ekranı (panel gelene kadar geçici) ----
app.get('/status', (req, res) => {
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

app.get('/', (req, res) => {
  res.send('HakanHoca Otomasyon sistemi çalışıyor. Durum için /status adresine bakabilirsiniz.');
});

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});

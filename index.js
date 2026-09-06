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

// ---- Şablonlar (panelden düzenlenebilen varsayılan metinler) ----
// Bu liste sadece İLK KURULUMDA config.json'a yazılır - sonrasında panelden
// (Şablonlar sekmesi) değiştirdiğin her şey config.json/GitHub üzerinden kalıcı olur.
const DEFAULT_PUBLIC_REPLY_TEMPLATES = [
  'Mesajı size ilettim. Güzel günlerde kullanın, umarım beğenirsiniz. Gönderiyi beğenmeyi ve takipte kalmayı unutmayın. 😊',
  'İstediğiniz içeriği size gönderdim. Güle güle kullanın, umarım işinize yarar. Gönderiyi beğenip takipte kalmayı unutmayın. 🌸',
  'Mesaj olarak ilettim. Umarım severek kullanırsınız. Gönderiyi beğenmeyi ve yeni paylaşımlar için takipte kalmayı unutmayın. ❤️',
  'İstediğiniz dosyayı size gönderdim. Güzel günlerde kullanmanız dileğiyle. Gönderiyi beğenmeyi ve takip etmeyi unutmayın. ✨',
  'İçeriği size mesaj olarak ilettim. Umarım faydalı olur. Beğeniniz ve takibiniz için şimdiden teşekkür ederim. 📚',
  'Gönderimi tamamladım, mesajlarınızı kontrol edebilirsiniz. Güle güle kullanın. Gönderiyi beğenmeyi ve takipte kalmayı unutmayın. 🌿',
  'İstediğiniz içeriği gönderdim. Umarım işinize yarar ve güzel günlerde kullanırsınız. Desteğiniz için teşekkür ederim. 🙏🏻',
  'Mesajı size ilettim. Umarım beğenirsiniz ve keyifle kullanırsınız. Yeni paylaşımlarımız için takipte kalmayı unutmayın. 💫',
  'Dosyayı mesaj yoluyla size gönderdim. Güle güle kullanın, umarım faydasını görürsünüz. Gönderiyi beğenmeyi unutmayın. 👍🏻',
  'İstediğiniz içeriği size ilettim. Güzel günlerde kullanın, umarım beklentinizi karşılar. Bizi takip etmeyi ve gönderiyi beğenmeyi unutmayın. 🌷',
];
const DEFAULT_MESSAGE_TEMPLATE = 'Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: {link}';

// ---- Basit dosya tabanlı veri saklama ----
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      sent: [], failed: [], retryQueue: [], replyCounters: {},
      dailyStats: {}, totalSentCount: 0, totalFailedCount: 0,
      followerHistory: {},
    };
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.replyCounters) data.replyCounters = {};
  if (!data.dailyStats) data.dailyStats = {};
  if (!data.followerHistory) data.followerHistory = {};
  if (typeof data.totalSentCount !== 'number') data.totalSentCount = data.sent ? data.sent.length : 0;
  if (typeof data.totalFailedCount !== 'number') data.totalFailedCount = data.failed ? data.failed.length : 0;
  return data;
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---- GitHub'daki data.json'ın (gönderim kayıtları) O ANKİ GERÇEK halini oku (sha ile) ----
async function fetchGithubData() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`;
  const res = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
  });
  if (!res.ok) return null; // dosya yok ya da erişilemedi - ilk oluşturma senaryosu
  const result = await res.json();
  if (!result.content) return null;
  const data = JSON.parse(Buffer.from(result.content, 'base64').toString('utf8'));
  if (!data.sent) data.sent = [];
  if (!data.failed) data.failed = [];
  if (!data.retryQueue) data.retryQueue = [];
  if (!data.replyCounters) data.replyCounters = {};
  if (!data.dailyStats) data.dailyStats = {};
  if (!data.followerHistory) data.followerHistory = {};
  if (typeof data.totalSentCount !== 'number') data.totalSentCount = data.sent.length;
  if (typeof data.totalFailedCount !== 'number') data.totalFailedCount = data.failed.length;
  return { data, sha: result.sha };
}

// ================== GÜVENLİ VERİ (gönderim kayıtları) DEĞİŞTİRME ==================
// ÖNEMLİ DÜZELTME: Eskiden "kaç PDF gönderildi / başarısız oldu" sayacı SADECE
// sunucunun yerel diskine yazılıyordu (data.json), GitHub'a hiç kaydedilmiyordu.
// Render her kayıtta / her aralıkta konteyneri yeniden oluşturduğu için, bu yerel
// dosya sık sık silinip sıfırdan başlıyordu - panelde "başarılı/başarısız" sayısının
// aniden sıfırlanması TAM OLARAK buydu. Artık config.json ile birebir aynı güvenli
// yöntemle (önce GitHub'daki güncel hali çek, değişikliği uygula, çakışma olursa
// tekrar dene) data.json da GitHub'a kalıcı olarak yazılıyor - bir daha sıfırlanmaz.
async function mutateData(mutatorFn) {
  const hasGithub = !!(GITHUB_TOKEN && GITHUB_REPO);
  const MAX_DENEME = 5;

  for (let deneme = 1; deneme <= MAX_DENEME; deneme++) {
    let data = null;
    let sha = null;

    if (hasGithub) {
      try {
        const remote = await fetchGithubData();
        if (remote) {
          data = remote.data;
          sha = remote.sha;
        }
      } catch (err) {
        console.error('GitHub güncel data.json okunamadı:', err.message);
      }
    }
    if (!data) data = loadData();

    mutatorFn(data);
    saveData(data);

    if (!hasGithub) return data;

    try {
      const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`;
      const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
      const body = { message: 'Gönderim kaydı güncellendi', content, branch: GITHUB_BRANCH };
      if (sha) body.sha = sha;

      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (putRes.ok) {
        return data;
      }
      if (putRes.status === 409 || putRes.status === 422) {
        console.log(`data.json GitHub üzerinde çakıştı (deneme ${deneme}/${MAX_DENEME}), en güncel hal tekrar çekilip deneniyor...`);
        continue;
      }
      const errText = await putRes.text();
      console.error('data.json GitHub kaydetme hatası:', putRes.status, errText);
      return data;
    } catch (err) {
      console.error('data.json GitHub bağlantı hatası:', err.message);
      return data;
    }
  }

  console.error('data.json GitHub ile senkronize edilemedi (çok fazla çakışma), son deneme yerel diske kaydedildi.');
  return loadData();
}

// Bir ISO zaman damgasını Türkiye saatine (Europe/Istanbul) göre "YYYY-MM-DD" gün
// anahtarına çevirir - günlük özet (hangi gün kaç PDF gönderildi) bu anahtara göre tutulur.
function istanbulGunAnahtari(isoZaman) {
  return new Date(isoZaman).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
}
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      posts: {}, pendingTemplates: {}, tokenRefreshedAt: null,
      publicReplyTemplates: [...DEFAULT_PUBLIC_REPLY_TEMPLATES],
      defaultMessageTemplate: DEFAULT_MESSAGE_TEMPLATE,
    };
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (!config.pendingTemplates) config.pendingTemplates = {};
  if (!config.tokenRefreshedAt) config.tokenRefreshedAt = null;
  if (!Array.isArray(config.publicReplyTemplates) || config.publicReplyTemplates.length === 0) {
    config.publicReplyTemplates = [...DEFAULT_PUBLIC_REPLY_TEMPLATES];
  }
  if (!config.defaultMessageTemplate) config.defaultMessageTemplate = DEFAULT_MESSAGE_TEMPLATE;
  return config;
}
function saveConfigLocal(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ---- GitHub'daki config.json'ın O ANKİ GERÇEK halini oku (sha ile birlikte) ----
async function fetchGithubConfig() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/config.json`;
  const res = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
  });
  if (!res.ok) return null; // dosya yok ya da erişilemedi - ilk oluşturma senaryosu
  const data = await res.json();
  if (!data.content) return null;
  const config = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  if (!config.posts) config.posts = {};
  if (!config.pendingTemplates) config.pendingTemplates = {};
  if (!config.tokenRefreshedAt) config.tokenRefreshedAt = null;
  if (!Array.isArray(config.publicReplyTemplates) || config.publicReplyTemplates.length === 0) {
    config.publicReplyTemplates = [...DEFAULT_PUBLIC_REPLY_TEMPLATES];
  }
  if (!config.defaultMessageTemplate) config.defaultMessageTemplate = DEFAULT_MESSAGE_TEMPLATE;
  return { config, sha: data.sha };
}

// ================== GÜVENLİ CONFIG DEĞİŞTİRME (yarış durumu / race condition koruması) ==================
// ÖNEMLİ: Render her kayıtta otomatik olarak yeni bir sunucu kopyası (deploy) başlatıyor.
// Bu yüzden aynı anda eski ve yeni kopya kısa süreliğine birlikte çalışabiliyor. ESKİDEN
// her değişiklik "yerel diskten oku -> değiştir -> GitHub'a olduğu gibi yolla" şeklinde
// yapılıyordu. Sorun şu: bir kopyanın belleğindeki eski hali GitHub'a yazılırsa, ARADA
// başka bir kopyanın (ya da panelin başka bir sekmesinin) yaptığı değişiklik sessizce
// silinip üzerine yazılabiliyordu. TAM OLARAK bunu yaşadın: iki "Planlanan" eklemiştin,
// biri gönderiye doğru bağlanacakken, arada devam eden bir başka kayıt işlemi GitHub'daki
// hali eski bir kopyayla ezdi ve "son eklenen" gönderiye yanlış şekilde yapıştı.
//
// ÇÖZÜM: Her değişiklikte ÖNCE GitHub'daki O ANKİ GERÇEK halini çekiyoruz, değişikliği
// SADECE o güncel hale uyguluyoruz, sonra geri yazıyoruz. Yazarken araya biri girip
// GitHub'ı değiştirmişse (sha uyuşmazlığı hatası döner), en güncel hali tekrar çekip
// değişikliği yeniden uyguluyor ve tekrar deniyoruz (birkaç kez). Böylece istekler hangi
// sırayla gelirse gelsin, hiçbiri diğerini ezip kaybettirmiyor.
//
// "mutatorFn" bu yüzden İDEMPOTENT olmalı: aynı mantıksal işlemi (örn. "şu id'li planı
// ekle", "şu mediaId'yi eğer henüz bağlı değilse şu şablona bağla") her denemede güvenle
// tekrar uygulayabilmeli - aşağıdaki tüm kullanım yerleri buna göre yazıldı.
async function mutateConfig(mutatorFn) {
  const hasGithub = !!(GITHUB_TOKEN && GITHUB_REPO);
  const MAX_DENEME = 5;

  for (let deneme = 1; deneme <= MAX_DENEME; deneme++) {
    let config = null;
    let sha = null;

    if (hasGithub) {
      try {
        const remote = await fetchGithubConfig();
        if (remote) {
          config = remote.config;
          sha = remote.sha;
        }
      } catch (err) {
        console.error('GitHub güncel config okunamadı:', err.message);
      }
    }
    if (!config) config = loadConfig();

    mutatorFn(config);
    saveConfigLocal(config);

    if (!hasGithub) return config;

    try {
      const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/config.json`;
      const content = Buffer.from(JSON.stringify(config, null, 2)).toString('base64');
      const body = { message: 'Panel üzerinden otomasyon güncellendi', content, branch: GITHUB_BRANCH };
      if (sha) body.sha = sha;

      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (putRes.ok) {
        return config;
      }
      if (putRes.status === 409 || putRes.status === 422) {
        console.log(`config.json GitHub üzerinde çakıştı (deneme ${deneme}/${MAX_DENEME}), en güncel hal tekrar çekilip deneniyor...`);
        continue;
      }
      const errText = await putRes.text();
      console.error('config.json GitHub kaydetme hatası:', putRes.status, errText);
      return config;
    } catch (err) {
      console.error('config.json GitHub bağlantı hatası:', err.message);
      return config;
    }
  }

  console.error('config.json GitHub ile senkronize edilemedi (çok fazla çakışma), son deneme yerel diske kaydedildi.');
  return loadConfig();
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
      const zaman = sonTokenYenilemeZamani;
      await mutateConfig((config) => {
        config.tokenRefreshedAt = zaman;
      });

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

// ================== TAKİPÇİ SAYISI GÜNLÜK TAKİBİ ==================
// Instagram'ın resmi API'si (Instagram Login dahil) tek tek "kim takip ediyor,
// kim etmiyor" listesini vermiyor - bu Meta'nın gizlilik kısıtlaması, kodla aşılamaz.
// Ama IG User üzerindeki "followers_count" alanı (TOPLAM takipçi sayısı) genel bir
// profil alanı olduğu için bu token ile de çalışması bekleniyor - bu yüzden burada
// her gün bir kez bu sayıyı çekip kaydediyoruz, panelde "bugün/bu hafta net değişim"
// olarak gösterebilmek için. API bu alanı reddederse (izin/kapsam sorunu olursa),
// hata sessizce loglanır ve panel "veri alınamıyor" durumunu gösterir - hiçbir şey
// bozulmaz, sadece bu özellik o zaman devre dışı kalmış olur.
async function takipciSayisiniGetirVeKaydet() {
  if (!igAccessToken || !IG_USER_ID) return;
  try {
    const res = await fetch(`${IG_GRAPH_BASE}/${IG_USER_ID}?fields=followers_count&access_token=${igAccessToken}`);
    const result = await res.json();
    if (result.error) {
      console.error('⚠️ Takipçi sayısı alınamadı:', result.error.message);
      return;
    }
    if (typeof result.followers_count !== 'number') {
      console.error('⚠️ Takipçi sayısı yanıtı beklenmedik biçimde geldi:', JSON.stringify(result));
      return;
    }
    const gun = istanbulGunAnahtari(new Date().toISOString());
    await mutateData((data) => {
      if (!data.followerHistory) data.followerHistory = {};
      data.followerHistory[gun] = result.followers_count;
      const gunler = Object.keys(data.followerHistory);
      if (gunler.length > 180) delete data.followerHistory[gunler[0]]; // en eski günü at
    });
    console.log(`👥 Takipçi sayısı kaydedildi: ${result.followers_count} (${gun})`);
  } catch (err) {
    console.error('⚠️ Takipçi sayısı bağlantı hatası:', err.message);
  }
}

// Uygulama açıldığında bir kez, sonra her 24 saatte bir tekrar kaydet.
takipciSayisiniGetirVeKaydet();
setInterval(takipciSayisiniGetirVeKaydet, 24 * 60 * 60 * 1000);

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

// Bir gönderi otomasyonu için gönderilecek son mesaj metnini oluşturur (düz metin sürümü).
// ÖNEMLİ DÜZELTME: Panelde kendi mesaj metnini yazan (ve linki metnin içine
// eklemeyi unutan) kullanıcılar için - link alanı dolu olduğu halde mesaj
// metninde o link geçmiyorsa, link otomatik olarak mesajın sonuna eklenir.
// Böylece "mesaj gitti ama link hiç gitmedi" durumu bir daha yaşanmaz.
function buildMessage(postConfig, config) {
  const link = (postConfig.link || '').trim();
  const sablon = (config && config.defaultMessageTemplate) || DEFAULT_MESSAGE_TEMPLATE;
  let message = (postConfig.replyMessage && postConfig.replyMessage.trim())
    ? postConfig.replyMessage.trim()
    : sablon.split('{link}').join(link);

  if (link && !message.includes(link)) {
    message = `${message}\n\n${link}`;
  }
  return message;
}

// Butonlu (tıklanabilir) mesaj için metin hazırlar - linki metnin içinden çıkarır,
// çünkü link artık düz yazı olarak değil, ayrı bir tıklanabilir buton olarak gidecek.
function buildButtonText(postConfig) {
  const link = (postConfig.link || '').trim();
  let text = (postConfig.replyMessage && postConfig.replyMessage.trim())
    ? postConfig.replyMessage.trim()
    : 'Merhaba 👋 Materyali aşağıdaki butona tıklayarak ücretsiz indirebilirsin.';

  if (link) {
    text = text.split(link).join('').trim();
  }
  if (!text) {
    text = 'Merhaba 👋 Materyali aşağıdaki butona tıklayarak ücretsiz indirebilirsin.';
  }
  return text.slice(0, 600);
}

// Tıklanabilir "PDF'e Ulaş" butonlu mesaj göndermeyi dener (Instagram'ın "button template"
// formatı). Bu, mesajın içine düz metin olarak yapıştırılan linkin tıklanmaması sorununu çözer.
// NOT: Meta bazı gönderim yollarında (örn. yoruma özel otomatik cevap) yalnızca düz metne
// izin verebiliyor - dokümantasyon bunu net belirtmiyor. Bu yüzden bu fonksiyon başarısız
// olursa (hata dönerse) false döner ve çağıran taraf otomatik olarak eski/garanti çalışan
// düz metin yöntemine (link metnin içinde) geri döner - hiçbir mesaj kaybolmaz.
async function trySendButtonMessage(commentId, buttonText, link, buttonTitle) {
  try {
    const response = await fetch(
      `${IG_GRAPH_BASE}/${IG_USER_ID}/messages?access_token=${igAccessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { comment_id: commentId },
          message: {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: buttonText,
                buttons: [
                  { type: 'web_url', url: link, title: buttonTitle.slice(0, 20) },
                ],
              },
            },
          },
        }),
      }
    );
    const result = await response.json();
    if (response.ok && !result.error) {
      return true;
    }
    console.log(
      'Butonlu mesaj gönderilemedi (' +
        (result.error ? result.error.message : 'bilinmeyen hata') +
        '), düz metne geri dönülüyor.'
    );
    return false;
  } catch (err) {
    console.log('Butonlu mesaj bağlantı hatası, düz metne geri dönülüyor:', err.message);
    return false;
  }
}

async function handleComment(value) {
  const commentId = value.id;
  const commentText = (value.text || '').toLowerCase().trim();
  const mediaId = value.media ? value.media.id : null;
  const fromUsername = value.from ? value.from.username : 'bilinmiyor';

  // Hikaye (story) yanıtları zaten bu "comments" webhook'undan HİÇ gelmez - onlar
  // Instagram'da bir DM'dir ve Meta'nın ayrı bir "messaging" webhook türünden gelir,
  // bu kod onu hiç işlemiyor bile. Yine de ekstra güvenlik için, Meta gönderi türünü
  // payload'da belirtirse (media_product_type), otomasyonu SADECE gerçek gönderi (FEED),
  // reels ve albüm gönderileri için çalıştırıyoruz - hikaye asla bu listeye girmez.
  const mediaProductType = value.media && value.media.media_product_type
    ? String(value.media.media_product_type).toUpperCase()
    : null;
  if (mediaProductType && !['FEED', 'REELS', 'CAROUSEL_ALBUM'].includes(mediaProductType)) {
    console.log(`Yorum "${mediaProductType}" türünde bir içerikten geldi (gönderi/reels değil), otomasyon atlandı.`);
    return;
  }

  const record = {
    commentId, mediaId, fromUsername,
    commentText: value.text || '',
    timestamp: new Date().toISOString(),
  };

  const config = loadConfig();
  let postConfig = mediaId ? config.posts[mediaId] : null;

  // Bu gönderi için henüz özel bir otomasyon yoksa, "Planlanan" (henüz paylaşılmamışken
  // hazırlanmış) otomasyonlardan anahtar kelimesi bu yorumla eşleşen var mı diye bak.
  // Eşleşme bulunursa, o taslak artık kalıcı olarak bu gerçek gönderiye bağlanır.
  //
  // ÖNEMLİ: Bu eşleştirme+bağlama işlemi artık mutateConfig() üzerinden, GitHub'daki
  // O ANKİ GERÇEK haline göre yapılıyor (yerel/bayat bir kopyaya göre değil) - böylece
  // aynı anda başka bir işlem (panelden yeni plan ekleme, başka bir yorum vb.) araya
  // girse bile, iki farklı planın karışıp yanlış gönderiye yapışması artık mümkün değil.
  if (!postConfig && mediaId) {
    let baglanan = null;
    await mutateConfig((config) => {
      // Bu deneme sırasında gönderi zaten başka bir işlemle bağlanmış olabilir -
      // o zaman yeniden eşleştirme yapmadan mevcut bağlıyı kullan.
      if (config.posts[mediaId]) {
        baglanan = config.posts[mediaId];
        return;
      }
      const pending = config.pendingTemplates || {};
      for (const pendingId of Object.keys(pending)) {
        const template = pending[pendingId];
        if (template.keyword && commentText.includes(template.keyword.toLowerCase())) {
          baglanan = { ...template };
          config.posts[mediaId] = baglanan;
          delete config.pendingTemplates[pendingId];
          console.log(`📌 Planlanan otomasyon ("${template.title || template.keyword}") gönderi ${mediaId} için bağlandı.`);
          break;
        }
      }
    });
    postConfig = baglanan;
  }

  if (!postConfig) {
    // Bu gönderi için otomasyon tanımlı değil - bu normal, hesaptaki her yorumu görüyoruz.
    // Hata olarak loglamaya gerek yok, sessizce geç.
    return;
  }

  const keyword = postConfig.keyword.toLowerCase();
  if (!commentText.includes(keyword)) return; // ilgisiz yorum, sessizce geç

  const baseRecord = { ...record, postTitle: postConfig.title || '', mediaId };

  // Önce tıklanabilir "PDF'e Ulaş" butonlu mesaj göndermeyi dene. Bu başarısız olursa
  // (Meta bu gönderim yolunda desteklemiyorsa) otomatik olarak eski, garanti çalışan
  // düz metin yöntemine (link mesajın içinde) geri dönülür - kullanıcı hiçbir ayar
  // yapmadan en iyi sonucu alır.
  let sent = false;
  if (postConfig.link) {
    sent = await trySendButtonMessage(
      commentId,
      buildButtonText(postConfig),
      postConfig.link,
      postConfig.buttonTitle || "PDF'e Ulaş 📎"
    );
    if (sent) {
      await logSent(baseRecord);
      console.log(`✅ Butonlu (tıklanabilir linkli) DM gönderildi: @${record.fromUsername}`);
    }
  }

  if (!sent) {
    const message = buildMessage(postConfig, config);
    await attemptSend(commentId, message, baseRecord);
  }

  // Herkese açık yorum cevabı da gönder (varsa) - dönüşümlü, hep aynısı olmasın
  if (postConfig.publicReplies && postConfig.publicReplies.length > 0) {
    const publicText = await pickNextPublicReply(mediaId, postConfig.publicReplies);
    await sendPublicReply(commentId, publicText);
  }
}

// Sırayla, hep aynı cevabı art arda kullanmadan bir sonraki metni seç
async function pickNextPublicReply(mediaId, replies) {
  let secilen = replies[0];
  await mutateData((data) => {
    if (!data.replyCounters) data.replyCounters = {};
    const currentIndex = data.replyCounters[mediaId] || 0;
    secilen = replies[currentIndex % replies.length];
    data.replyCounters[mediaId] = (currentIndex + 1) % replies.length;
  });
  return secilen;
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
      await logSent(record);
      console.log(`✅ DM gönderildi: @${record.fromUsername}`);
    } else {
      const errorMsg = result.error ? result.error.message : 'Bilinmeyen hata';
      const errorCode = result.error ? result.error.code : null;
      if (errorCode === 4 || errorCode === 17 || errorCode === 32) {
        await addToRetryQueue(commentId, message, record);
        await logFailed({ ...record, reason: `Limit doldu, tekrar denenecek: ${errorMsg}` });
      } else {
        await logFailed({ ...record, reason: errorMsg });
      }
    }
  } catch (err) {
    await logFailed({ ...record, reason: `Bağlantı hatası: ${err.message}` });
  }
}

// ÖNEMLİ: Artık data.json'a her yazma işlemi mutateData() üzerinden, GitHub'daki
// GÜNCEL haline göre yapılıyor - böylece hem "sayaç sıfırlanıyor" hatası çözülüyor,
// hem de aynı anda birden fazla gönderim olsa bile (mesela bir gönderiye aynı anda
// çok sayıda yorum gelmesi) hiçbir kayıt birbirinin üzerine yazıp kaybolmuyor.
//
// "sent" ve "failed" listeleri paneldeki "Son Gönderilenler / Başarısız Olanlar"
// bölümü için son 500/200 kayıtla sınırlı tutuluyor (dosya çok büyümesin diye),
// AMA gerçek toplam sayı (totalSentCount / totalFailedCount) hiçbir zaman
// sıfırlanmıyor/kırpılmıyor - panelde görünen "Gönderildi" rakamı bu yüzden artık
// kalıcı ve doğru. Ayrıca "dailyStats" ile hangi gün kaç PDF gönderildiği ve
// o gün kimlere gönderildiği (kullanıcı adları) ayrı ayrı, kalıcı olarak tutuluyor
// (son 180 gün) - panelde "Günlük Özet" bu veriden geliyor.
async function logSent(record) {
  const sentAt = new Date().toISOString();
  const gun = istanbulGunAnahtari(sentAt);
  await mutateData((data) => {
    data.sent.push({ ...record, sentAt });
    if (data.sent.length > 500) data.sent.splice(0, data.sent.length - 500);
    data.totalSentCount = (data.totalSentCount || 0) + 1;

    if (!data.dailyStats) data.dailyStats = {};
    if (!data.dailyStats[gun]) {
      const gunler = Object.keys(data.dailyStats);
      if (gunler.length >= 180) delete data.dailyStats[gunler[0]]; // en eski günü at, yer aç
      data.dailyStats[gun] = { count: 0, users: [] };
    }
    data.dailyStats[gun].count += 1;
    if (record.fromUsername && !data.dailyStats[gun].users.includes(record.fromUsername)) {
      data.dailyStats[gun].users.push(record.fromUsername);
    }
  });
}

async function logFailed(record) {
  await mutateData((data) => {
    data.failed.push(record);
    if (data.failed.length > 200) data.failed.splice(0, data.failed.length - 200);
    data.totalFailedCount = (data.totalFailedCount || 0) + 1;
  });
}

async function addToRetryQueue(commentId, message, record) {
  await mutateData((data) => {
    data.retryQueue.push({ commentId, message, record, addedAt: new Date().toISOString() });
  });
}

setInterval(async () => {
  let queue = [];
  await mutateData((data) => {
    queue = [...data.retryQueue];
    data.retryQueue = [];
  });
  if (queue.length === 0) return;
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

// Son Instagram gönderilerini getir. "after" parametresi verilirse (sayfalama),
// Instagram'ın verdiği o sayfadan devam eder - böylece 25'ten eski gönderilere de
// "Daha Fazla Göster" butonuyla ulaşılabilir. Zaten kaydedilmiş otomasyonlar
// (config.json) bu listeleme mantığından tamamen bağımsız saklanır, hiçbir zaman silinmez.
app.get('/admin/api/posts', async (req, res) => {
  try {
    const after = req.query.after ? `&after=${encodeURIComponent(req.query.after)}` : '';
    const response = await fetch(
      `${IG_GRAPH_BASE}/${IG_USER_ID}/media?fields=id,caption,permalink,media_url,thumbnail_url,timestamp,media_type&limit=25${after}&access_token=${igAccessToken}`
    );
    const result = await response.json();
    if (result.error) return res.status(500).json({ error: result.error.message });

    const config = loadConfig();
    const posts = (result.data || []).map((post) => ({
      ...post,
      automation: config.posts[post.id] || null,
    }));
    const nextCursor = result.paging && result.paging.cursors ? result.paging.cursors.after : null;
    const hasMore = !!(result.paging && result.paging.next);
    res.json({ posts, nextCursor, hasMore });
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
  const newAutomation = {
    title: title || '',
    keyword,
    link,
    replyMessage: replyMessage || `Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: ${link}`,
    publicReplies: Array.isArray(publicReplies) ? publicReplies.filter((r) => r && r.trim()) : [],
  };
  await mutateConfig((config) => {
    config.posts[mediaId] = newAutomation;
  });
  res.json({ ok: true, config: newAutomation });
});

// Bir gönderinin otomasyonunu sil
app.delete('/admin/api/posts/:mediaId', async (req, res) => {
  await mutateConfig((config) => {
    delete config.posts[req.params.mediaId];
  });
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
  const id = 'p_' + Date.now();
  const newTemplate = {
    title: title || '',
    keyword,
    link,
    replyMessage: replyMessage || `Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: ${link}`,
    publicReplies: Array.isArray(publicReplies) ? publicReplies.filter((r) => r && r.trim()) : [],
  };
  await mutateConfig((config) => {
    config.pendingTemplates[id] = newTemplate;
  });
  res.json({ ok: true, id });
});

app.delete('/admin/api/pending/:id', async (req, res) => {
  await mutateConfig((config) => {
    delete config.pendingTemplates[req.params.id];
  });
  res.json({ ok: true });
});

// ================== ŞABLONLAR (panelden düzenlenebilen hazır metinler) ==================
// "Yorum Altı Otomatik Cevaplar" havuzu (+ Cevap Ekle butonunun kullandığı liste) ve
// "Mesaj metni" boş bırakıldığında kullanılan varsayılan DM şablonu artık burada,
// config.json üzerinden panelden düzenlenebiliyor - eskiden admin.html içine
// gömülüydü, değiştirmek için kod düzenlemek gerekiyordu.
app.get('/admin/api/templates', (req, res) => {
  const config = loadConfig();
  res.json({
    publicReplyTemplates: config.publicReplyTemplates,
    defaultMessageTemplate: config.defaultMessageTemplate,
  });
});

app.post('/admin/api/templates', async (req, res) => {
  const { publicReplyTemplates, defaultMessageTemplate } = req.body;
  const temizlenmisListe = Array.isArray(publicReplyTemplates)
    ? publicReplyTemplates.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  if (temizlenmisListe.length === 0) {
    return res.status(400).json({ error: 'En az 1 yorum altı cevap şablonu olmalı' });
  }
  const mesajSablonu = (typeof defaultMessageTemplate === 'string' && defaultMessageTemplate.trim())
    ? defaultMessageTemplate.trim()
    : DEFAULT_MESSAGE_TEMPLATE;

  await mutateConfig((config) => {
    config.publicReplyTemplates = temizlenmisListe;
    config.defaultMessageTemplate = mesajSablonu;
  });
  res.json({ ok: true });
});

// ================== TAKİPÇİ (trend + hızlı özet) ==================
app.get('/admin/api/followers', (req, res) => {
  const data = loadData();
  const history = data.followerHistory || {};
  const gunler = Object.keys(history).sort(); // eskiden yeniye (YYYY-MM-DD string sıralaması güvenli)

  if (gunler.length === 0) {
    return res.json({ veriVarMi: false });
  }

  const guncelSayi = history[gunler[gunler.length - 1]];
  const bugunDegisim = gunler.length >= 2
    ? history[gunler[gunler.length - 1]] - history[gunler[gunler.length - 2]]
    : 0;
  const yediGunOncekiAnahtar = gunler.length > 7 ? gunler[gunler.length - 8] : gunler[0];
  const haftalikDegisim = gunler.length >= 2
    ? history[gunler[gunler.length - 1]] - history[yediGunOncekiAnahtar]
    : 0;

  const son7Gun = gunler.slice(-7).map((gun, i, arr) => {
    const oncekiGun = i === 0 ? null : arr[i - 1];
    const degisim = oncekiGun === null ? 0 : history[gun] - history[oncekiGun];
    return { tarih: gun, sayi: history[gun], degisim };
  });

  res.json({ veriVarMi: true, guncelSayi, bugunDegisim, haftalikDegisim, son7Gun });
});

// ================== AYARLAR (salt-okunur sistem bilgisi) ==================
// ÖNEMLİ: Şifre asla burada döndürülmüyor - sadece kullanıcı adı ve token/sistem durumu.
app.get('/admin/api/settings', (req, res) => {
  const config = loadConfig();
  res.json({
    adminUser: ADMIN_USER,
    tokenVarMi: !!igAccessToken,
    tokenYenilemeZamani: config.tokenRefreshedAt || null,
  });
});

// Bir günün ("YYYY-MM-DD") ait olduğu "ay içi hafta" anahtarını üretir: "2026-05-H1",
// "2026-05-H2" gibi - yani "Mayıs 1. Hafta, Mayıs 2. Hafta" mantığıyla, HER AY KENDİ
// İÇİNDE 1'den başlayarak numaralanır (ayın 1-7. günleri 1. hafta, 8-14. günleri
// 2. hafta, ... 29-31. günleri 5. hafta). Böylece hafta hiçbir zaman ay sınırını
// aşmaz ve "Mayıs 1. Hafta" dediğinde herkesin anladığı gibi çalışır.
function haftaAnahtariUret(gunAnahtari) {
  const gun = Number(gunAnahtari.slice(8, 10));
  const haftaNo = Math.ceil(gun / 7); // 1..5
  return `${gunAnahtari.slice(0, 7)}-H${haftaNo}`;
}

// dailyStats'ı (gün -> {count, users}) istenen gruba (hafta başlangıcı ya da "YYYY-MM" ay)
// göre toplayan genel amaçlı yardımcı fonksiyon. Kullanıcı adlarını tekrarsız (Set) tutar,
// böylece "bu hafta/ay kimler yazdı" listesi aynı kişiyi birden fazla göstermez.
function ozetOlustur(dailyStats, anahtarFn, sinir) {
  const sonuc = {};
  Object.keys(dailyStats).forEach((gun) => {
    const anahtar = anahtarFn(gun);
    if (!sonuc[anahtar]) sonuc[anahtar] = { count: 0, users: new Set() };
    sonuc[anahtar].count += dailyStats[gun].count;
    (dailyStats[gun].users || []).forEach((u) => sonuc[anahtar].users.add(u));
  });
  return Object.keys(sonuc)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, sinir)
    .map((anahtar) => ({
      anahtar,
      adet: sonuc[anahtar].count,
      kullanicilar: Array.from(sonuc[anahtar].users),
    }));
}

// Durum raporu
// ÖNEMLİ DÜZELTME: "basariylaGonderilen/basarisizOlan" artık data.json'daki
// totalSentCount/totalFailedCount kalıcı sayaçlarından geliyor - bu sayılar
// artık GitHub'a kalıcı yazıldığı için sunucu yeniden başlasa (redeploy, ücretsiz
// planın uykuya dalıp uyanması vb.) bile SIFIRLANMAZ.
//
// YENİ: Artık sadece günlük değil, HAFTALIK ve AYLIK özet de dönüyor (hepsi
// dailyStats'tan anlık hesaplanıyor, ayrı bir yerde saklamaya gerek yok). Ayrıca
// "bugün / bu hafta / bu ay" hızlı sayıları da ekleniyor - panel bunları tek
// bakışta gösterebilsin diye.
app.get('/admin/api/status', (req, res) => {
  const data = loadData();
  const dailyStats = data.dailyStats || {};

  const gunlukOzet = Object.keys(dailyStats)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, 60)
    .map((tarih) => ({
      tarih,
      adet: dailyStats[tarih].count,
      kullanicilar: dailyStats[tarih].users || [],
    }));

  const haftalikOzet = ozetOlustur(dailyStats, haftaAnahtariUret, 30); // son ~6-7 ay
  const aylikOzet = ozetOlustur(dailyStats, (gun) => gun.slice(0, 7), 24); // son 24 ay

  const bugunGunAnahtari = istanbulGunAnahtari(new Date().toISOString());
  const buHaftaAnahtari = haftaAnahtariUret(bugunGunAnahtari);
  const buAyAnahtari = bugunGunAnahtari.slice(0, 7);
  let bugunAdet = 0, buHaftaAdet = 0, buAyAdet = 0;
  Object.keys(dailyStats).forEach((gun) => {
    const adet = dailyStats[gun].count;
    if (gun === bugunGunAnahtari) bugunAdet += adet;
    if (haftaAnahtariUret(gun) === buHaftaAnahtari) buHaftaAdet += adet;
    if (gun.slice(0, 7) === buAyAnahtari) buAyAdet += adet;
  });

  res.json({
    ozet: {
      basariylaGonderilen: typeof data.totalSentCount === 'number' ? data.totalSentCount : data.sent.length,
      basarisizOlan: typeof data.totalFailedCount === 'number' ? data.totalFailedCount : data.failed.length,
      tekrarDenenecek: data.retryQueue.length,
    },
    hizliOzet: { bugun: bugunAdet, buHafta: buHaftaAdet, buAy: buAyAdet },
    gunlukOzet,
    haftalikOzet,
    aylikOzet,
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

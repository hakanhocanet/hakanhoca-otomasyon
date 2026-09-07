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

// ================== VERİ BRANCH'İ (Render'ın gereksiz redeploy'unu ve fatura riskini önlemek için) ==================
// ÖNEMLİ: Render, bu repo'ya (GITHUB_BRANCH, yani "main") yapılan HER PUSH'TA otomatik olarak
// yeniden build+deploy yapıyor. Ama data.json/config.json dosyalarına HER DM gönderiminde, her
// başarısız denemede, her ayar değişikliğinde (kara liste, duraklat, planlanan otomasyon vb.)
// yazıyoruz - bu da "main" branch'ine sürekli commit demek, bu da Render'ın sürekli (ve tamamen
// gereksiz) redeploy yapması demek, bu da ücretsiz "pipeline dakikası" kotasının hızla tükenip
// ek ücrete (her 1000 dakika için $5) dönüşmesi demek.
//
// ÇÖZÜM: data.json ve config.json artık kod branch'inden (GITHUB_BRANCH) TAMAMEN AYRI bir
// branch'e (GITHUB_DATA_BRANCH, varsayılan "veri") yazılıyor. Render sadece "main" branch'ini
// izleyip deploy ettiği için, redeploy artık SADECE senin panelden gerçek kod değişikliği yapıp
// GitHub'a yapıştırdığın anlarda (yani zaten istediğin zamanlarda) tetikleniyor - her DM/kayıt
// işlemi bir daha asla deploy tetiklemiyor. Hiçbir veri kaybolmuyor/değişmiyor, sadece HANGİ
// branch'e yazıldığı değişti.
const GITHUB_DATA_BRANCH = process.env.GITHUB_DATA_BRANCH || 'veri';

// Uygulama ilk açıldığında "veri" branch'i GitHub'da yoksa (ilk kurulum / bu güncellemeden
// sonraki ilk açılış), "main" branch'inin O ANKİ halinden otomatik olarak oluşturur - telefondan
// yönetilen bu sistemde kullanıcının GitHub'a girip elle branch oluşturmasına hiç gerek kalmaz.
async function veriBranchiniGarantiyeAl() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;
  try {
    const kontrolRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/git/ref/heads/${GITHUB_DATA_BRANCH}`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
    );
    if (kontrolRes.ok) {
      console.log(`✅ "${GITHUB_DATA_BRANCH}" veri branch'i zaten mevcut, veriler oraya yazılıyor.`);
      return;
    }
    if (kontrolRes.status !== 404) {
      console.error('⚠️ Veri branch kontrolü beklenmedik hata döndürdü:', kontrolRes.status);
      return;
    }

    const anaRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
    );
    if (!anaRes.ok) {
      console.error(`⚠️ "${GITHUB_BRANCH}" branch'i okunamadı, "${GITHUB_DATA_BRANCH}" oluşturulamadı.`);
      return;
    }
    const anaData = await anaRes.json();
    const sha = anaData.object && anaData.object.sha;
    if (!sha) return;

    const olusturRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${GITHUB_DATA_BRANCH}`, sha }),
    });
    if (olusturRes.ok) {
      console.log(`✅ "${GITHUB_DATA_BRANCH}" veri branch'i "${GITHUB_BRANCH}" üzerinden otomatik oluşturuldu. Artık veri kayıtları redeploy tetiklemeyecek.`);
    } else {
      const errText = await olusturRes.text();
      console.error('⚠️ Veri branch\'i oluşturulamadı:', olusturRes.status, errText);
    }
  } catch (err) {
    console.error('⚠️ Veri branch\'i garantiye alma hatası:', err.message);
  }
}
// NOT: Bu fonksiyon burada ÇAĞRILMIYOR - sunucuyuBaslat() içinde, app.listen'dan
// ÖNCE, sırayla çalıştırılıyor (bkz. dosyanın en altı). Sıra önemli: önce "veri" branch'i
// var olduğundan emin ol, SONRA oradan yerel diske senkronize et, SONRA istekleri kabul
// etmeye başla.

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

// ================== DM GÜVENLİ GÖNDERİM SINIRI (ceza/kısıtlama riskini önlemek için) ==================
// Meta'nın resmi Graph API belgelerine göre, burada kullanılan "yoruma özel mesaj" (comment_id
// üzerinden DM) yöntemi için saatlik sınır 750 çağrı/saat/hesap. Biz bunun belirgin bir miktar
// altında kalarak (güvenlik payı bırakarak) BU SINIRA ASLA DEĞMEMEYİ hedefliyoruz - sınıra değmek
// hesabın geçici olarak kısıtlanmasına/cezalandırılmasına yol açabilir. Sınıra yaklaşılırsa
// mesajlar KAYBOLMAZ, sadece var olan 30 dakikalık "tekrar deneme" döngüsüne ertelenir - bir
// sonraki uygun anda otomatik olarak gönderilirler.
const META_SAATLIK_LIMIT = 750; // Meta'nın resmi belgelenmiş sınırı (Private Replies - Posts/Reels)
const GUVENLI_SAATLIK_LIMIT = 600; // bizim bıraktığımız güvenlik payıyla kendi tavanımız (~%80)

// ---- Basit dosya tabanlı veri saklama ----
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      sent: [], failed: [], retryQueue: [], replyCounters: {},
      dailyStats: {}, totalSentCount: 0, totalFailedCount: 0,
      followerHistory: {},
      mesajGonderimZamanlari: [], postSendCounts: {}, eslesmeyenYorumlar: [],
      totalRateLimitDeferCount: 0,
    };
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.replyCounters) data.replyCounters = {};
  if (!data.dailyStats) data.dailyStats = {};
  if (!data.followerHistory) data.followerHistory = {};
  if (!data.mesajGonderimZamanlari) data.mesajGonderimZamanlari = [];
  if (!data.postSendCounts) data.postSendCounts = {};
  if (!data.eslesmeyenYorumlar) data.eslesmeyenYorumlar = [];
  if (typeof data.totalRateLimitDeferCount !== 'number') data.totalRateLimitDeferCount = 0;
  if (typeof data.totalSentCount !== 'number') data.totalSentCount = data.sent ? data.sent.length : 0;
  if (typeof data.totalFailedCount !== 'number') data.totalFailedCount = data.failed ? data.failed.length : 0;
  return data;
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---- GitHub'daki data.json'ın (gönderim kayıtları) O ANKİ GERÇEK halini oku (sha ile) ----
// NOT: "veri" branch'inden okunuyor (GITHUB_BRANCH/"main" değil) - bkz. GITHUB_DATA_BRANCH açıklaması.
async function fetchGithubData() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`;
  const res = await fetch(`${apiUrl}?ref=${GITHUB_DATA_BRANCH}`, {
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
  if (!data.mesajGonderimZamanlari) data.mesajGonderimZamanlari = [];
  if (!data.postSendCounts) data.postSendCounts = {};
  if (!data.eslesmeyenYorumlar) data.eslesmeyenYorumlar = [];
  if (typeof data.totalRateLimitDeferCount !== 'number') data.totalRateLimitDeferCount = 0;
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
      const body = { message: 'Gönderim kaydı güncellendi', content, branch: GITHUB_DATA_BRANCH };
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
      blacklistedUsers: [], automationPaused: false,
    };
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (!config.pendingTemplates) config.pendingTemplates = {};
  if (!config.tokenRefreshedAt) config.tokenRefreshedAt = null;
  if (!Array.isArray(config.publicReplyTemplates) || config.publicReplyTemplates.length === 0) {
    config.publicReplyTemplates = [...DEFAULT_PUBLIC_REPLY_TEMPLATES];
  }
  if (!config.defaultMessageTemplate) config.defaultMessageTemplate = DEFAULT_MESSAGE_TEMPLATE;
  if (!Array.isArray(config.blacklistedUsers)) config.blacklistedUsers = [];
  if (typeof config.automationPaused !== 'boolean') config.automationPaused = false;
  return config;
}
function saveConfigLocal(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ---- GitHub'daki config.json'ın O ANKİ GERÇEK halini oku (sha ile birlikte) ----
// NOT: "veri" branch'inden okunuyor (GITHUB_BRANCH/"main" değil) - bkz. GITHUB_DATA_BRANCH açıklaması.
async function fetchGithubConfig() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/config.json`;
  const res = await fetch(`${apiUrl}?ref=${GITHUB_DATA_BRANCH}`, {
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
  if (!Array.isArray(config.blacklistedUsers)) config.blacklistedUsers = [];
  if (typeof config.automationPaused !== 'boolean') config.automationPaused = false;
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
      const body = { message: 'Panel üzerinden otomasyon güncellendi', content, branch: GITHUB_DATA_BRANCH };
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

// ================== PANELDEKİ GÖRÜNTÜLEME (GET) UÇ NOKTALARI İÇİN "HER ZAMAN GÜNCEL" OKUMA ==================
// ÖNEMLİ (planlanan otomasyonun "kaybolmuş gibi görünmesi" hatasının GERÇEK sebebi - 2. kısım):
// Render'ın ücretsiz planı, birkaç dakika istek gelmeyince sunucuyu tamamen kapatıyor ve bir
// sonraki istekte SIFIRDAN yeniden başlatıyor (konteynerin yerel diski o an TAMAMEN BOŞ). Açılışta
// bir kere GitHub'dan yerel diske senkronizasyon yapılıyor (ilkAcilistaGithubdanSenkronizeEt), AMA
// o istek GitHub'a giderken ÇOK NADİR de olsa geçici bir ağ/GitHub API hatası yaşanabilir - böyle
// bir anda o özel konteyner kopyasının yerel diski BOŞ kalmış olabilir. Panelin GET uç noktaları
// (Planlanan, Gönderiler, Şablonlar, Kara Liste, Ayarlar, Durum, Takipçi vb.) ESKİDEN SADECE bu
// yerel diski okuyordu - yani GitHub'da veri gayet sağlam dururken, sırf o anki konteyner kopyası
// henüz senkronize olamadığı için panelde "yokmuş gibi/silinmiş gibi" görünebiliyordu. Hiçbir şey
// GERÇEKTEN silinmiyordu, sadece o anki gösterim yanlıştı.
//
// ÇÖZÜM: Panelin TÜM GET uç noktaları artık ÖNCE GitHub'daki O ANKİ GERÇEK haline bakıyor (tıpkı
// mutateConfig/mutateData'nın yazarken yaptığı gibi), sadece GitHub'a hiç ulaşılamazsa (token
// ayarlanmamış, internet/GitHub sorunu vb.) yerel diskteki en son bilinen hale geri dönüyor. Böylece
// panelde gördüğün her şey, o an GitHub'da GERÇEKTEN duran haliyle birebir eşleşiyor - "acaba bu
// konteyner kopyası senkronize oldu mu" diye asla merak etmene gerek kalmıyor.
async function readConfig() {
  if (GITHUB_TOKEN && GITHUB_REPO) {
    try {
      const remote = await fetchGithubConfig();
      if (remote) {
        saveConfigLocal(remote.config); // yerel önbelleği de tazele, bir sonraki okuma/restart daha güvenli olsun
        return remote.config;
      }
    } catch (err) {
      console.error('GitHub güncel config okunamadı (panel görüntüleme), yerel diske geri dönülüyor:', err.message);
    }
  }
  return loadConfig();
}

async function readData() {
  if (GITHUB_TOKEN && GITHUB_REPO) {
    try {
      const remote = await fetchGithubData();
      if (remote) {
        saveData(remote.data); // yerel önbelleği de tazele
        return remote.data;
      }
    } catch (err) {
      console.error('GitHub güncel data.json okunamadı (panel görüntüleme), yerel diske geri dönülüyor:', err.message);
    }
  }
  return loadData();
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

// Saatlik güvenli DM gönderim sınırına (GUVENLI_SAATLIK_LIMIT) şu an ulaşılmış mı diye bakar.
// Yerel diskteki (loadData) veriyle hızlıca kontrol ediyoruz - saniye hassasiyetinde kusursuz
// olması gerekmiyor, çünkü Meta'nın gerçek sınırının (750) belirgin altında (600) durarak zaten
// geniş bir güvenlik payı bırakıyoruz.
async function saatlikLimitDoluMu() {
  const data = loadData();
  const simdi = Date.now();
  const zamanlar = (data.mesajGonderimZamanlari || []).filter((t) => simdi - t < 60 * 60 * 1000);
  return zamanlar.length >= GUVENLI_SAATLIK_LIMIT;
}

// Instagram'a atılan her gerçek /messages çağrısının zamanını kaydeder (logSent/logFailed
// içinden, zaten var olan mutateData çağrısına eklenerek - ekstra bir GitHub gidiş-gelişine
// gerek kalmadan). 65 dakikadan eski kayıtlar atılır (60 dakikalık pencere + küçük tampon).
function kaydetGonderimZamani(data) {
  if (!data.mesajGonderimZamanlari) data.mesajGonderimZamanlari = [];
  const simdi = Date.now();
  data.mesajGonderimZamanlari.push(simdi);
  data.mesajGonderimZamanlari = data.mesajGonderimZamanlari.filter((t) => simdi - t < 65 * 60 * 1000);
}

// ================== YORUM/ANAHTAR KELİME KARŞILAŞTIRMA ÖNCESİ TEMİZLİK ==================
// ŞİKAYET: "PDF" yazıp hemen ardına emoji ekleyen bazı kullanıcılara mesaj gitmiyor. Eşleştirme
// zaten esnek (yorumun İÇİNDE anahtar kelime geçiyor mu diye bakıyor, tam eşleşme aramıyor) -
// yani normalde "pdf😍" yazan biri "pdf" anahtar kelimesiyle otomatik eşleşmeli. En olası sebep,
// panelde o gönderi için kayıtlı anahtar kelimenin kendisine fark edilmeden bir boşluk, büyük/küçük
// harf farkı ya da GÖRÜNMEZ bir unicode karakter karışmış olması (telefonda kopyala-yapıştır ya da
// emoji klavyesi bazen fark edilmeyen "sıfır genişlikli" karakterler ekleyebiliyor - bunlar ekranda
// hiç görünmez ama metni birebir karşılaştırırken farklı yapar). Bu fonksiyon hem gelen yorumu hem
// panelde kayıtlı anahtar kelimeyi AYNI şekilde temizleyip karşılaştırıyor: baştaki/sondaki boşluklar
// atılıyor, art arda gelen boşluklar teke indiriliyor, bilinen görünmez karakterler siliniyor, hepsi
// küçük harfe çevriliyor. Böylece "elle bakınca aynı görünen ama aslında farklı olan" iki metin
// yüzünden mesajın sessizce gitmemesi bir daha yaşanmaz.
function metniTemizle(str) {
  return String(str || '')
    .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g, '') // sifir genislikli/birlestirici, BOM, kesintisiz bosluk
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Bir gönderide otomasyon TANIMLI DEĞİLKEN gelen yorumları "Kaçırılan Fırsatlar" olarak kaydeder
// (Hesap Durumu sayfasında gösterilir) - belki bu gönderi için de bir otomasyon kurman gerekiyordur.
async function kaydetEslesmeyenYorum(kayit) {
  await mutateData((data) => {
    if (!data.eslesmeyenYorumlar) data.eslesmeyenYorumlar = [];
    data.eslesmeyenYorumlar.push(kayit);
    if (data.eslesmeyenYorumlar.length > 50) {
      data.eslesmeyenYorumlar.splice(0, data.eslesmeyenYorumlar.length - 50);
    }
  });
}

async function handleComment(value) {
  const commentId = value.id;
  const commentText = metniTemizle(value.text);
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

  // Otomasyon panelden "Hesap Durumu" sayfasından geçici olarak duraklatılmış olabilir
  // (acil durum/tatil vb.) - açık olduğu sürece hiçbir yoruma DM/cevap gitmez. Yorum
  // kaybolmaz, sadece bu otomasyon turu atlanır (Instagram bu yorumu tekrar göndermez,
  // bu yüzden duraklatma kapatıldığında geçmişe dönük bir "yetişme" olmaz - bunu bilerek
  // kullan).
  if (config.automationPaused) {
    console.log('⏸️ Otomasyon duraklatılmış durumda, yorum atlandı.');
    return;
  }

  // Kara listedeki bir kullanıcıdan geliyorsa (spam/istenmeyen hesap), hiçbir şekilde
  // DM ya da herkese açık cevap gönderilmez.
  if ((config.blacklistedUsers || []).includes(fromUsername.toLowerCase())) {
    console.log(`🚫 @${fromUsername} kara listede, yorum atlandı.`);
    return;
  }

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
        if (template.keyword && commentText.includes(metniTemizle(template.keyword))) {
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
    // Hata olarak loglamaya gerek yok ama "Hesap Durumu" sayfasındaki Kaçırılan Fırsatlar
    // listesine kaydediyoruz - belki bu gönderi için de bir otomasyon kurman gerekiyordur.
    await kaydetEslesmeyenYorum({
      fromUsername, commentText: value.text || '', mediaId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const keyword = metniTemizle(postConfig.keyword);
  if (!commentText.includes(keyword)) {
    // ÖNEMLİ: Bu gönderi için otomasyon VAR ama bu yorumdaki anahtar kelime eşleşmedi.
    // "PDF yazıp hemen ardına emoji koyan bazı kişilere mesaj gitmiyor" şikayetini
    // araştırabilmek için burayı Render loglarına yazıyoruz - normalde eşleşme metnin
    // İÇİNDE geçmesi yeterli olacak kadar esnek (tam eşleşme aramıyor), bu yüzden bir
    // eşleşmeme genelde ya panelde kayıtlı anahtar kelimede fark edilmeyen bir boşluk/
    // emoji/farklı harf olduğunu ya da yorumun gerçekten alakasız olduğunu gösterir.
    // Loglardaki "Beklenen" ve "Gelen yorum" değerlerini karşılaştırarak ayırt edebiliriz.
    console.log(`ℹ️ Otomasyonlu gönderiye yorum geldi ama anahtar kelime eşleşmedi. Beklenen: "${keyword}" | Gelen yorum (temizlenmiş): "${commentText}" | Kullanıcı: @${fromUsername}`);
    return; // ilgisiz yorum, sessizce geç
  }

  const baseRecord = { ...record, postTitle: postConfig.title || '', mediaId };

  // ---- GÜVENLİ GÖNDERİM SINIRI KONTROLÜ ----
  // Saatlik güvenli tavana (GUVENLI_SAATLIK_LIMIT) ulaşıldıysa DM'yi ŞİMDİ göndermeye
  // ÇALIŞMIYORUZ - mesaj kaybolmuyor, var olan 30 dakikalık tekrar deneme kuyruğuna
  // ertelenip bir sonraki uygun anda otomatik olarak gönderiliyor. Bu sayede Meta'nın
  // 750/saat sınırına asla değmiyoruz. NOT: Herkese açık yorum cevabı (aşağıda) bu
  // sınırdan etkilenmez - o farklı bir API uç noktasını (comment replies) kullanıyor.
  if (await saatlikLimitDoluMu()) {
    const message = buildMessage(postConfig, config);
    await addToRetryQueue(commentId, message, baseRecord, 'rate_limit');
    console.log(`⏳ Saatlik güvenli DM sınırına (${GUVENLI_SAATLIK_LIMIT}/saat) ulaşıldı, mesaj sıraya alındı: @${record.fromUsername}`);
  } else {
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
        // Bu, BİZİM 600/saat güvenlik tavanımızdan değil, doğrudan Meta'nın kendisinden
        // gelen bir rate-limit hatası - normalde hiç görmememiz gerekir (zaten altında
        // kalıyoruz), görülürse "rateLimited: true" ile işaretleyip Hesap Durumu
        // sayfasında görünür kılıyoruz - bu bir uyarı sinyalidir.
        await addToRetryQueue(commentId, message, record);
        await logFailed({ ...record, reason: `Limit doldu, tekrar denenecek: ${errorMsg}`, rateLimited: true });
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

    // Hız sınırı takibi: bu, Instagram'a atılmış gerçek bir /messages çağrısı -
    // saatlik güvenli sınır hesaplaması (saatlikLimitDoluMu) bu zaman damgalarını sayıyor.
    kaydetGonderimZamani(data);

    // Gönderi bazlı istatistik (İstatistikler sayfası): bu gönderiden toplam kaç DM gitti.
    if (record.mediaId) {
      if (!data.postSendCounts) data.postSendCounts = {};
      data.postSendCounts[record.mediaId] = (data.postSendCounts[record.mediaId] || 0) + 1;
    }
  });
}

async function logFailed(record) {
  await mutateData((data) => {
    data.failed.push(record);
    if (data.failed.length > 200) data.failed.splice(0, data.failed.length - 200);
    data.totalFailedCount = (data.totalFailedCount || 0) + 1;
    // Başarısız da olsa Meta'ya gerçek bir /messages çağrısı atılmıştır, bu yüzden
    // hız sınırı sayacına o da dahil ediliyor.
    kaydetGonderimZamani(data);
  });
}

// "sebep" 'rate_limit' olarak verilirse, bu BİZİM kendi 600/saat güvenlik tavanımıza takılıp
// proaktif olarak ertelenen bir mesajdır (bir hata DEĞİL) - Hesap Durumu sayfasındaki
// "sıraya alınıp ertelenen gönderim" sayacına ekleniyor. Meta'nın kendisinden gelen gerçek
// rate-limit hataları (attemptSend içinde) ayrı ve "rateLimited: true" ile işaretleniyor.
async function addToRetryQueue(commentId, message, record, sebep) {
  await mutateData((data) => {
    data.retryQueue.push({ commentId, message, record, addedAt: new Date().toISOString(), sebep: sebep || null });
    if (sebep === 'rate_limit') {
      data.totalRateLimitDeferCount = (data.totalRateLimitDeferCount || 0) + 1;
    }
  });
}

setInterval(async () => {
  let queue = [];
  await mutateData((data) => {
    queue = [...data.retryQueue];
    data.retryQueue = [];
  });
  if (queue.length === 0) return;
  for (let i = 0; i < queue.length; i++) {
    // Bu döngü sırasında da saatlik güvenli sınıra ulaşılmış olabilir (örn. kuyrukta çok
    // sayıda ertelenmiş mesaj birikmişse) - böyle bir durumda kalanları tekrar kuyruğa
    // koyup bu turu burada kesiyoruz, bir sonraki 30 dakikalık döngüde devam edilir.
    // Hiçbir mesaj kaybolmuyor, sadece güvenli hızda gönderiliyor.
    if (await saatlikLimitDoluMu()) {
      const kalanlar = queue.slice(i);
      await mutateData((data) => {
        data.retryQueue.push(...kalanlar);
      });
      console.log(`⏳ Tekrar deneme döngüsünde saatlik güvenli sınıra ulaşıldı, ${kalanlar.length} mesaj bir sonraki döngüye ertelendi.`);
      break;
    }
    const item = queue[i];
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

    const config = await readConfig();
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

// ================== İSTATİSTİKLER (gönderi bazlı beğeni/yorum + kaç DM gitti) ==================
// NOT: "like_count" ve "comments_count" alanları Instagram Login (Business hesabı) kapsamında
// genel medya alanları - ama tüm hesap türlerinde/izin seviyelerinde garantili çalıştığı
// dokümantasyonda net değil (followers_count'ta olduğu gibi). Bu yüzden savunmacı yazıldı:
// alan gelmezse null olarak döner, panel o zaman "—" gösterir, hiçbir şey bozulmaz.
app.get('/admin/api/post-stats', async (req, res) => {
  try {
    const response = await fetch(
      `${IG_GRAPH_BASE}/${IG_USER_ID}/media?fields=id,caption,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=50&access_token=${igAccessToken}`
    );
    const result = await response.json();
    if (result.error) return res.status(500).json({ error: result.error.message });

    const data = await readData();
    const postSendCounts = data.postSendCounts || {};

    const posts = (result.data || []).map((post) => ({
      id: post.id,
      caption: post.caption || '',
      thumbnail: post.thumbnail_url || post.media_url || '',
      permalink: post.permalink || null,
      likeCount: typeof post.like_count === 'number' ? post.like_count : null,
      commentsCount: typeof post.comments_count === 'number' ? post.comments_count : null,
      dmGonderilen: postSendCounts[post.id] || 0,
    }));

    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================== HESAP DURUMU (ceza/kısıtlama riskini gözle görünür kılan sayfa) ==================
app.get('/admin/api/account-health', async (req, res) => {
  const config = await readConfig();
  const data = await readData();
  const simdi = Date.now();

  const zamanlar = (data.mesajGonderimZamanlari || []).filter((t) => simdi - t < 60 * 60 * 1000);
  const saatlikGonderim = zamanlar.length;

  const son24SaatRateLimitHatasi = (data.failed || []).filter((f) => {
    return f.rateLimited && f.timestamp && (simdi - new Date(f.timestamp).getTime()) < 24 * 60 * 60 * 1000;
  }).length;

  const sorunVarMi = saatlikGonderim >= GUVENLI_SAATLIK_LIMIT || son24SaatRateLimitHatasi > 0;

  res.json({
    otomasyonDuraklatildiMi: !!config.automationPaused,
    saatlikGonderim,
    saatlikGuvenliLimit: GUVENLI_SAATLIK_LIMIT,
    metaResmiLimit: META_SAATLIK_LIMIT,
    son24SaatRateLimitHatasi,
    toplamErtelenen: data.totalRateLimitDeferCount || 0,
    saglikli: !sorunVarMi,
    blacklist: config.blacklistedUsers || [],
    eslesmeyenYorumlar: (data.eslesmeyenYorumlar || []).slice(-20).reverse(),
  });
});

app.post('/admin/api/account-health/pause', async (req, res) => {
  const { paused } = req.body;
  await mutateConfig((config) => {
    config.automationPaused = !!paused;
  });
  res.json({ ok: true, otomasyonDuraklatildiMi: !!paused });
});

// ---- Kara liste (istenmeyen/spam kullanıcı adlarına otomasyon hiç çalışmaz) ----
app.post('/admin/api/blacklist', async (req, res) => {
  const temiz = String((req.body && req.body.username) || '').trim().replace(/^@/, '').toLowerCase();
  if (!temiz) return res.status(400).json({ error: 'Kullanıcı adı gerekli' });
  await mutateConfig((config) => {
    if (!Array.isArray(config.blacklistedUsers)) config.blacklistedUsers = [];
    if (!config.blacklistedUsers.includes(temiz)) config.blacklistedUsers.push(temiz);
  });
  res.json({ ok: true });
});

app.delete('/admin/api/blacklist/:username', async (req, res) => {
  const temiz = decodeURIComponent(req.params.username).trim().toLowerCase();
  await mutateConfig((config) => {
    config.blacklistedUsers = (config.blacklistedUsers || []).filter((u) => u !== temiz);
  });
  res.json({ ok: true });
});

// ================== PLANLANAN OTOMASYONLAR (henüz paylaşılmamış gönderiler için) ==================
// Bir gönderiyi paylaşmadan önce otomasyonunu "taslak" olarak kaydedebilirsin.
// Gönderi paylaşılıp o anahtar kelimeyle ilk yorum geldiğinde, sistem bu taslağı otomatik
// olarak gerçek gönderiye bağlar (bkz. handleComment() içindeki eşleştirme mantığı).

app.get('/admin/api/pending', async (req, res) => {
  const config = await readConfig();
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

// Var olan bir planlanan otomasyonu DÜZENLER. Bilerek silip-yeniden-eklemiyoruz:
// config.pendingTemplates bir obje ve JS'te mevcut bir anahtarın değerini yerinde
// güncellemek (delete+set değil, doğrudan atama) o anahtarın Object.keys() sırasındaki
// konumunu DEĞİŞTİRMEZ. handleComment() içindeki eşleştirme ve panelde "N. sırada"
// etiketi bu sıraya göre çalıştığı için, düzenleme kuyruktaki yeri asla bozmaz.
app.put('/admin/api/pending/:id', async (req, res) => {
  const { title, keyword, link, replyMessage, publicReplies } = req.body;
  if (!keyword || !link) {
    return res.status(400).json({ error: 'Anahtar kelime ve link zorunlu' });
  }
  const id = req.params.id;
  let bulunduMu = false;
  await mutateConfig((config) => {
    if (!config.pendingTemplates[id]) return;
    bulunduMu = true;
    config.pendingTemplates[id] = {
      title: title || '',
      keyword,
      link,
      replyMessage: replyMessage || `Merhaba 👋 Materyali ücretsiz olarak buradan indirebilirsin: ${link}`,
      publicReplies: Array.isArray(publicReplies) ? publicReplies.filter((r) => r && r.trim()) : [],
    };
  });
  if (!bulunduMu) {
    return res.status(404).json({ error: 'Planlanan otomasyon bulunamadı' });
  }
  res.json({ ok: true });
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
app.get('/admin/api/templates', async (req, res) => {
  const config = await readConfig();
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

// ================== TAKİPÇİ (trend + gün/hafta/ay karşılaştırmalı özet) ==================
// dailyStats'a benzer bir mantıkla, ama burada tutulan şey "kaç PDF gönderildi" değil,
// "takipçi sayısı bir önceki kayıtlı güne göre ne kadar değişti" (net değişim). Bu günlük
// değişim serisi üretildikten sonra, Durum sayfasındaki AYNI haftaAnahtariUret() fonksiyonuyla
// hafta/ay anahtarına göre toplanabiliyor - böylece Takipçi sayfası da Durum ile birebir aynı
// "Günlük / Haftalık / Aylık" karşılaştırma modeline sahip oluyor.
function ozetOlusturSayisal(gunlukDegerler, anahtarFn, sinir) {
  const sonuc = {};
  Object.keys(gunlukDegerler).forEach((gun) => {
    const anahtar = anahtarFn(gun);
    if (typeof sonuc[anahtar] !== 'number') sonuc[anahtar] = 0;
    sonuc[anahtar] += gunlukDegerler[gun];
  });
  return Object.keys(sonuc)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, sinir)
    .map((anahtar) => ({ anahtar, degisim: sonuc[anahtar] }));
}

app.get('/admin/api/followers', async (req, res) => {
  const data = await readData();
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

  // Günlük net değişim serisi: her gün için bir önceki KAYITLI güne göre fark.
  // İlk kayıtlı gün için karşılaştıracak önceki gün olmadığından o gün atlanır.
  const gunlukDegisimler = {};
  gunler.forEach((gun, i) => {
    if (i === 0) return;
    gunlukDegisimler[gun] = history[gun] - history[gunler[i - 1]];
  });

  const gunlukOzet = Object.keys(gunlukDegisimler)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, 60)
    .map((tarih) => ({ tarih, degisim: gunlukDegisimler[tarih], sayi: history[tarih] }));

  const haftalikOzet = ozetOlusturSayisal(gunlukDegisimler, haftaAnahtariUret, 30); // son ~6-7 ay
  const aylikOzet = ozetOlusturSayisal(gunlukDegisimler, (gun) => gun.slice(0, 7), 24); // son 24 ay

  // Durum sayfasındaki "hızlıÖzet" ile aynı fikirde: bugün/bu hafta/bu ay net değişim.
  const bugunGunAnahtari = istanbulGunAnahtari(new Date().toISOString());
  const buHaftaAnahtari = haftaAnahtariUret(bugunGunAnahtari);
  const buAyAnahtari = bugunGunAnahtari.slice(0, 7);
  let buAyDegisim = 0;
  Object.keys(gunlukDegisimler).forEach((gun) => {
    if (gun.slice(0, 7) === buAyAnahtari) buAyDegisim += gunlukDegisimler[gun];
  });

  res.json({
    veriVarMi: true,
    guncelSayi, bugunDegisim, haftalikDegisim, buAyDegisim,
    son7Gun,
    gunlukOzet, haftalikOzet, aylikOzet,
  });
});

// ================== AYARLAR (sistem sağlığı + bildirimler bir arada) ==================
// ÖNEMLİ: Şifre asla burada döndürülmüyor - sadece kullanıcı adı ve token/sistem durumu.
// Başarısız gönderim bildirimleri, token yenileme durumu ve genel sistem sağlığı ile
// ilgili HER ŞEY artık tek bir yerde (bu uç nokta / Ayarlar sayfası) toplanıyor - eskiden
// başarısız gönderimler sadece Durum sayfasında, dağınık şekilde görünüyordu.
const TOKEN_YENILEME_ARALIGI_MS = 45 * 24 * 60 * 60 * 1000;

app.get('/admin/api/settings', async (req, res) => {
  const config = await readConfig();
  const data = await readData();

  let tokenKalanGun = null;
  if (config.tokenRefreshedAt) {
    const kalanMs = TOKEN_YENILEME_ARALIGI_MS - (Date.now() - config.tokenRefreshedAt);
    tokenKalanGun = Math.max(0, Math.ceil(kalanMs / (24 * 60 * 60 * 1000)));
  }

  const simdi = Date.now();
  const failedList = data.failed || [];
  const basarisizSon24Saat = failedList.filter((f) => {
    return f.timestamp && (simdi - new Date(f.timestamp).getTime()) < 24 * 60 * 60 * 1000;
  }).length;
  const sonBasarisizlar = failedList.slice(-5).reverse().map((f) => ({
    fromUsername: f.fromUsername || 'bilinmiyor',
    reason: f.reason || '',
    timestamp: f.timestamp || null,
  }));

  res.json({
    adminUser: ADMIN_USER,
    tokenVarMi: !!igAccessToken,
    tokenYenilemeZamani: config.tokenRefreshedAt || null,
    tokenKalanGun,
    saglik: {
      basarisizToplam: typeof data.totalFailedCount === 'number' ? data.totalFailedCount : failedList.length,
      basarisizSon24Saat,
      tekrarBekleyen: (data.retryQueue || []).length,
      sonBasarisizlar,
      takipciVerisiVarMi: !!(data.followerHistory && Object.keys(data.followerHistory).length > 0),
    },
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
app.get('/admin/api/status', async (req, res) => {
  const data = await readData();
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
    // NOT: Başarısız gönderimlerin ayrıntılı listesi artık burada değil - bildirim/sağlık
    // amaçlı her şey tek bir yerde toplansın diye /admin/api/settings üzerinden, Ayarlar
    // sayfasında gösteriliyor. Buradaki "ozet.basarisizOlan" sadece kalıcı sayaç.
  });
});

// ================== CSV DIŞA AKTARMA (Excel'de açılabilir kayıt indirme) ==================
function csvSatiriYaz(degerler) {
  return degerler.map((v) => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(',') + '\n';
}

app.get('/admin/api/export/:tur', async (req, res) => {
  const data = await readData();
  const tur = req.params.tur;
  let basliklar = [];
  let satirlar = [];

  if (tur === 'sent') {
    basliklar = ['Tarih', 'Kullanici', 'Yorum', 'Gonderi Basligi'];
    satirlar = (data.sent || []).map((s) => [s.sentAt || '', s.fromUsername || '', s.commentText || '', s.postTitle || '']);
  } else if (tur === 'failed') {
    basliklar = ['Tarih', 'Kullanici', 'Yorum', 'Sebep'];
    satirlar = (data.failed || []).map((f) => [f.timestamp || '', f.fromUsername || '', f.commentText || '', f.reason || '']);
  } else {
    return res.status(400).send('Geçersiz tür (sent ya da failed olmalı)');
  }

  // Başa BOM (﻿) ekliyoruz ki Excel Türkçe karakterleri (ş, ı, ğ vb.) doğru göstersin.
  let csv = '﻿' + csvSatiriYaz(basliklar);
  satirlar.forEach((s) => { csv += csvSatiriYaz(s); });

  const dosyaAdi = `hakanhoca-${tur}-${istanbulGunAnahtari(new Date().toISOString())}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${dosyaAdi}"`);
  res.send(csv);
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

// ================== İLK AÇILIŞTA GITHUB'DAN SENKRONİZASYON ==================
// ÖNEMLİ (kaybolan "Planlanan otomasyon" hatasının GERÇEK sebebi): Render her redeploy'da
// konteyneri SIFIRDAN oluşturuyor - yerel diskteki data.json/config.json o an TAMAMEN SİLİNMİŞ
// oluyor. loadData()/loadConfig() dosya yoksa BOŞ/varsayılan değerler döndürüyor (posts: {},
// pendingTemplates: {} gibi). Panelin GET uç noktaları (örn. /admin/api/pending,
// /admin/api/posts) SADECE yerel diskten okuyor - GitHub'a hiç bakmıyor. Yani: redeploy
// olduktan hemen sonra, henüz hiçbir DM/kayıt işlemi (mutateData/mutateConfig, ki bunlar
// GitHub'dan taze veri çekiyor) çalışmadan panele bakarsan, GERÇEKTE GitHub'da duran
// "Planlanan" otomasyonların HİÇBİRİ KAYBOLMAMIŞ olsa bile panelde "yokmuş gibi" görünüyordu.
// Ve Render her data/config yazımında yeniden deploy tetiklediği için (bu artık "veri"
// branch'ine taşındığı için düzeldi, ama GERÇEK bir kod güncellemesi/redeploy sırasında hâlâ
// olabilir), bu durum tam da "bir gönderi paylaştım, mesajlar gitti/yazıldı (ki bu commit'lere
// yol açar) ve hemen sonra panelde planlanan otomasyonlar gitmiş gibi görünüyor" senaryosuyla
// birebir örtüşüyor.
//
// ÇÖZÜM: Sunucu istek kabul etmeye başlamadan ÖNCE, GitHub'daki (veri branch'indeki) GÜNCEL
// data.json ve config.json bir kere yerel diske çekiliyor. Böylece panel HİÇBİR ZAMAN
// "geçici olarak boş" bir görüntü göstermiyor - konteyner ne zaman yeniden oluşursa oluşsun,
// ilk istekten itibaren gerçek, güncel veriler orada.
async function ilkAcilistaGithubdanSenkronizeEt() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log('GITHUB_TOKEN/GITHUB_REPO ayarlanmamış, açılış senkronizasyonu atlanıyor (sadece yerel disk kullanılacak).');
    return;
  }
  try {
    const remoteData = await fetchGithubData();
    if (remoteData) {
      saveData(remoteData.data);
      console.log('✅ data.json açılışta GitHub\'dan ("' + GITHUB_DATA_BRANCH + '" branch\'i) yerel diske senkronize edildi.');
    } else {
      console.log('ℹ️ GitHub\'da henüz bir data.json yok (muhtemelen ilk kurulum) - yerel varsayılanlar kullanılacak.');
    }
  } catch (err) {
    console.error('⚠️ Açılışta data.json senkronizasyonu başarısız, yerel disk kullanılacak:', err.message);
  }
  try {
    const remoteConfig = await fetchGithubConfig();
    if (remoteConfig) {
      saveConfigLocal(remoteConfig.config);
      console.log('✅ config.json açılışta GitHub\'dan ("' + GITHUB_DATA_BRANCH + '" branch\'i) yerel diske senkronize edildi.');
    } else {
      console.log('ℹ️ GitHub\'da henüz bir config.json yok (muhtemelen ilk kurulum) - yerel varsayılanlar kullanılacak.');
    }
  } catch (err) {
    console.error('⚠️ Açılışta config.json senkronizasyonu başarısız, yerel disk kullanılacak:', err.message);
  }
}

async function sunucuyuBaslat() {
  // Sıra kasıtlı: önce "veri" branch'inin var olduğundan emin ol, SONRA oradan yerel diske
  // çek, EN SON istekleri kabul etmeye başla - böylece webhook/panel hiçbir zaman yarım/boş
  // bir yerel diskle karşılaşmaz.
  await veriBranchiniGarantiyeAl();
  await ilkAcilistaGithubdanSenkronizeEt();
  app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
  });
}
sunucuyuBaslat();

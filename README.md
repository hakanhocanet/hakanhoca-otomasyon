# HakanHoca Otomasyon

Instagram'da bir gönderiye "PDF" (veya belirlediğin kelime) yazan herkese,
o gönderiye özel bağlantıyı **anında** özel mesaj olarak gönderir.
Gönderilemeyenler (limit doldu, engellenmiş, 7 gün geçmiş vb.) ayrı listede tutulur.

## Kurulum Adımları

### 1. GitHub'a yükle
Bu klasördeki dosyaları yeni bir GitHub deposuna (repository) yükle.

### 2. Render.com'da yayınla (ücretsiz)
1. render.com'a git, GitHub hesabınla giriş yap
2. "New +" -> "Web Service"
3. Az önce oluşturduğun GitHub deposunu seç
4. Ayarlar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. "Environment Variables" (Ortam değişkenleri) kısmına şunları ekle:
   - `IG_ACCESS_TOKEN` = (Meta'dan aldığın uzun access token)
   - `VERIFY_TOKEN` = kendi belirlediğin bir kelime (örn: `hakanhoca2026`)
6. "Create Web Service" ile yayınla

### 3. Meta Developer panelinde webhook'u bağla
1. developers.facebook.com -> uygulaman -> Instagram -> Configure webhooks
2. **Callback URL:** Render'ın sana verdiği adres + `/webhook`
   (örnek: `https://hakanhoca-otomasyon.onrender.com/webhook`)
3. **Verify Token:** Render'a girdiğin `VERIFY_TOKEN` ile birebir aynı olmalı
4. "Verify and Save" butonuna bas

### 4. Hangi gönderiye hangi link gidecek? (config.json)
`config.json` dosyasını düzenle. Her gönderi için:
```json
"GONDERI_ID": {
  "title": "Gönderi adı (sadece senin görmen için)",
  "keyword": "PDF",
  "link": "https://hakanhoca.net/xxx",
  "replyMessage": "Kullanıcıya gidecek tam mesaj"
}
```

**Gönderi ID'sini nasıl bulursun?**
Instagram gönderisinin linkine gidip, Graph API Explorer üzerinden
`/me/media` ile gönderi ID'lerini listeleyebilirsin. Bu adımda ayrıca
yardımcı olabilirim.

### 5. Durumu kontrol etme
Yayınlandıktan sonra tarayıcıdan şu adrese gidersen basit bir rapor görürsün:
`https://[senin-adresin].onrender.com/status`

- Kaç DM gönderildi
- Kaç tanesi başarısız oldu ve neden
- Kaç tanesi tekrar denenmeyi bekliyor

## Önemli Notlar
- Render'ın ücretsiz katmanı, uzun süre istek gelmezse "uyku" moduna geçer,
  ilk istekte 30-60 saniye uyanma süresi olabilir. Yorum trafiği arttıkça
  bu sorun olmaktan çıkar.
- Meta'nın kuralı: bir yoruma en fazla 7 gün içinde DM açılabilir, saatte
  hesap başına 200 DM limiti var. Sistem bunları otomatik yönetir.

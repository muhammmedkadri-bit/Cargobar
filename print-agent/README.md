# Cargobar Yazdırma Ajanı

Bu, Zjiang yazıcının **fiziksel olarak takılı olduğu bilgisayarda** çalışan,
görünmez, arka plan servisidir. Cargobar web sayfası bu servise "şunu yazdır"
der, servis de ham komutları doğrudan yazıcıya iletir. Kurulduktan sonra
bir daha hiç dokunmanız gerekmez.

## 1) Ön koşul: Node.js

https://nodejs.org adresinden **LTS** sürümünü indirip kurun (Next, Next, Finish).

## 2) Kurulum

```
cd print-agent
npm install
```

## 3) Ayarları kontrol edin

İlk çalıştırmada otomatik oluşan `config.json` dosyasını açın:

```json
{
  "port": 9198,
  "windowsShareName": "ZjiangEtiket",
  "allowedOrigins": ["https://cargobar.vercel.app", ...],
  "apiToken": "..."
}
```

- **windowsShareName**: Denetim Masası → Aygıtlar ve Yazıcılar → yazıcıya
  sağ tık → Yazıcı Özellikleri → **Paylaşım** sekmesindeki "Paylaşım Adı"
  ile BİREBİR aynı olmalı (yazıcının kendi adı değil, paylaşım adı).
  Paylaşım kapalıysa şimdi açın ve bir isim verin (boşluksuz, örn: `ZjiangEtiket`).
- **allowedOrigins**: Cargobar'ı hangi adres(ler)den açıyorsanız oraya
  `https://cargobar.vercel.app` zaten eklendi; kendi domaininiz farklıysa ekleyin.
- **apiToken**: Bunu kopyalayıp Cargobar → Ayarlar → "Yazıcı Ajanı" alanına
  yapıştıracaksınız (frontend tarafı ayrıca gönderilecek).

## 4) Çalıştırıp test edin

```
node server.js
```

Terminalde `Cargobar Print Agent çalışıyor: http://localhost:9198` yazısını
görmelisiniz. Tarayıcıda `http://localhost:9198/health` adresini açın,
`{"ok":true,...}` dönmeli.

## 5) Yazıcı dili tespiti (TSPL mi ESC/POS mu?)

Zjiang'ın kesin modelinden emin olmadığımız için önce şunu deneyin
(agent çalışırken, terminalde `curl` yoksa PowerShell'de `Invoke-RestMethod`
kullanabilirsiniz, ya da Cargobar Ayarlar ekranındaki "Test Yazdır" düğmesini
kullanın — aşağıda anlatılıyor):

```
curl -X POST http://localhost:9198/test/tspl -H "X-Print-Token: <config.json'daki token>"
```

- Etikette düzgün "TSPL TEST OK" yazısı çıkarsa → **yazıcınız TSPL** kullanıyor
  (Zjiang'ın etiket/label modellerinin büyük çoğunluğu böyledir; 100x100mm
  boşluklu/ayraçlı etiketler için doğru dil budur).
- Anlamsız karakterler / kağıt boşa geçerse şunu deneyin:

```
curl -X POST http://localhost:9198/test/escpos -H "X-Print-Token: <token>"
```

Hangisi düzgün çıkıyorsa Cargobar tarafında o dili kullanacağız
(`print-engine.js` içinde `LABEL_LANG` değişkeni).

**Ek ipucu:** Yazıcıyı kapalıyken besleme (FEED) tuşunu basılı tutup açarsanız
çoğu Zjiang etiket yazıcısı model/DPI/komut setini gösteren bir öz-test
etiketi basar — bu da modeli netleştirmenin hızlı bir yolu.

## 6) Otomatik başlatma (kur-unut)

**Önerilen (sağlam, servis olarak):**
```
node install-service.js
```
(Bu komutu "Yönetici olarak çalıştır" ile açılmış bir terminalde çalıştırın.)
Bilgisayar yeniden başlasa bile ajan kendiliğinden ayağa kalkar.

**Basit alternatif (yönetici hakkı gerekmez):**
`run-hidden.vbs` dosyasının kısayolunu `shell:startup` klasörüne koyun
(detaylar dosyanın içinde açıklanmış).

## 7) Güvenlik notu

Ajan sadece `config.json` içindeki `allowedOrigins` listesinde olan
sitelerden, doğru `X-Print-Token` başlığıyla gelen isteklere yazdırma
izni verir. Böylece başka bir web sitesi sizin bilginiz dışında
yazıcınıza bir şey bastıramaz.

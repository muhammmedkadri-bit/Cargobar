# Cargobar Yazıcı Entegrasyonu Kurulum Kılavuzu (Fiziksel Kurulum Adımları)

Yazıcı fiziksel olarak bilgisayara bağlı olduğunda (veya bilgisayarın başına geçtiğinizde) sırasıyla aşağıdaki adımları takip etmeniz gerekmektedir. 

---

### Adım 1: Node.js Kurulumu
1. Yazıcının bağlı olduğu bilgisayarda [https://nodejs.org](https://nodejs.org) adresine gidin.
2. **LTS (Önerilen)** yazan yeşil butona tıklayarak kurulum dosyasını indirin.
3. İndirdiğiniz dosyayı çalıştırıp standart seçeneklerle ("İleri", "İleri", "Bitir") kurulumu tamamlayın.

---

### Adım 2: Yazıcıyı Paylaşıma Açmak ve Paylaşım Adını Almak (Windows)
1. **Denetim Masası > Aygıtlar ve Yazıcılar** ekranını açın.
2. Kullandığınız termal etiket yazıcısına (Zjiang) sağ tıklayıp **Yazıcı Özellikleri (Printer Properties)** seçeneğini seçin.
3. Üstteki sekmelerden **Paylaşım (Sharing)** sekmesine tıklayın.
4. **"Bu yazıcıyı paylaştır"** kutucuğunu işaretleyin.
5. Paylaşım adı kutusuna boşluk bırakmadan basit bir isim yazın. (Örn: `ZjiangEtiket`).
6. **Uygula** ve **Tamam** butonlarına tıklayarak pencereyi kapatın.
7. Bu verdiğiniz **Paylaşım Adı**'nı bir yere not edin (bir sonraki adımda gerekecek).

---

### Adım 3: Yazdırma Ajanı Kurulumu ve Başlatılması
1. Cargobar klasörü içindeki `print-agent` klasörünü açın.
2. Windows Arama çubuğuna `cmd` yazın ve Komut İstemi'ni (Command Prompt) açın.
3. Komut satırında `cd` komutu ile `print-agent` klasörünün içine gidin. Örneğin:
   ```cmd
   cd Desktop\Cargobar\print-agent
   ```
4. Bağımlılıkları yüklemek için şu komutu çalıştırın:
   ```cmd
   npm install
   ```
5. Kurulum tamamlandıktan sonra servisi ilk kez çalıştırmak ve yapılandırma dosyasını oluşturmak için:
   ```cmd
   node server.js
   ```
6. Konsolda `Cargobar Print Agent çalışıyor: http://localhost:9198` ibaresini göreceksiniz. 
7. Aynı zamanda ekranda **API Token: ...** şeklinde uzun bir şifre (token) görüntülenecektir. Bu şifreyi kopyalayın.

---

### Adım 4: Yapılandırma (`config.json` Güncelleme)
1. `print-agent` klasörünün içine `config.json` adında yeni bir dosya oluşmuş olmalıdır.
2. Bu dosyayı Not Defteri (Notepad) ile açın.
3. `"windowsShareName": "ZjiangEtiket"` alanındaki ismi, **Adım 2**'de yazıcıya verdiğiniz **Paylaşım Adı** ile birebir aynı olacak şekilde güncelleyin.
4. Dosyayı kaydedip kapatın. Komut satırındaki servisi kapatıp (Ctrl + C) yeniden `node server.js` yazarak başlatın.

---

### Adım 5: Web Arayüzünde Yazıcı Ajanını Bağlamak
1. Tarayıcınızda Cargobar uygulamasını açın.
2. Sol alt menüden **Ayarlar** butonuna tıklayın.
3. Açılan ayarlar penceresinde yeni eklenen **Yazıcı Ajanı** sekmesine geçin.
4. Alanları şu şekilde doldurun:
   - **Ajan Adresi:** `http://localhost:9198` (Varsayılan değerdir, değiştirmeyin).
   - **API Token (X-Print-Token):** **Adım 3**'te kopyaladığınız uzun şifreyi buraya yapıştırın.
   - **Etiket Dili:** `TSPL` (Zjiang etiket yazıcıları için standart dil budur).
5. **Bağlantıyı Test Et** butonuna tıklayın. *"Yazıcı ajanına başarıyla bağlanıldı"* mesajını görmelisiniz.

---

### Adım 6: Doğru Etiket Dilini (TSPL / ESC-POS) Keşfetmek
1. Yazıcınızda rulo etiketlerin takılı olduğundan emin olun.
2. Ayarlar > Yazıcı Ajanı ekranındaki **Test Etiket Yazdır** butonuna tıklayın.
3. Yazıcıdan net bir şekilde **"TSPL TEST OK"** ve **"100x100mm"** yazıları çıkarsa, yazıcınız TSPL dilini destekliyor demektir. Başka bir işlem yapmanıza gerek yoktur.
4. Eğer boş kağıt çıkarsa veya anlamsız karakterler basarsa:
   - Etiket Dili ayarını **ESC/POS** olarak değiştirin.
   - Tekrar **Test Etiket Yazdır** butonuna tıklayarak test çıktısı alın.

---

### Adım 7: Arka Planda Otomatik Başlatma (Kur-Unut)
Test çıktılarınız sorunsuz bir şekilde basıldıktan sonra, bilgisayar her açıldığında servisin otomatik çalışması için:
1. Komut satırını kapatın.
2. `print-agent` klasörünü açın.
3. Klasör içindeki `run-hidden.vbs` dosyasının üzerine sağ tıklayıp **Kısayol Oluştur (Create Shortcut)** seçeneğini seçin.
4. Windows tuşu + R tuşuna aynı anda basarak **Çalıştır (Run)** penceresini açın.
5. Kutuya `shell:startup` yazıp Enter tuşuna basın. Açılan klasör Windows başlangıç klasörüdür.
6. Az önce oluşturduğunuz `run-hidden.vbs - Kısayol` dosyasını bu başlangıç klasörünün içine sürükleyip bırakın.
7. Artık bilgisayar her açıldığında etiket yazdırma servisi arka planda görünmez ve otomatik olarak çalışacaktır.

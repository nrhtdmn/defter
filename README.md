# Defter

Telefonda kullanmak için tasarlanmış, modern ve çevrimdışı çalışan not PWA’sı.

**Canlı:** [https://nrhtdmn.github.io/defter/](https://nrhtdmn.github.io/defter/)

Nurhat DUMAN tarafından üretilmiştir.

Veriler yalnızca cihazınızda (IndexedDB) saklanır. İnternet olmadan da çalışır.

## Özellikler

- Not oluşturma, düzenleme, silme
- Markdown yazım + önizleme
- Kontrol listeleri, kalın/italik, başlık, alıntı, kod
- Klasörler ve etiketler
- Sabitleme, favoriler, renk etiketleri
- Arama, sıralama, liste / ızgara görünümü
- Arşiv ve çöp kutusu
- Şablonlar (günlük, toplantı, fikir, alışveriş)
- Hatırlatıcılar
- PIN kilidi
- Açık / koyu / sistem teması
- Yazı boyutu ayarı
- JSON yedekleme / geri yükleme
- Markdown dışa aktarma ve paylaşım
- Ana ekrana eklenebilir PWA

## GitHub Pages ile yayınlama

1. Bu klasörü bir GitHub reposuna yükleyin.
2. Repo **Settings → Pages → Source**: `Deploy from a branch`
3. Branch: `main` (veya `master`), klasör: `/ (root)`
4. Birkaç dakika sonra adres:  
   `https://KULLANICI_ADINIZ.github.io/REPO_ADI/`

> Repo adınız `kullanici.github.io` ise site kökte açılır; aksi halde uygulama alt yolda çalışacak şekilde göreli yollar kullanır.

## Telefona ekleme

1. Yayınlanan adresi Chrome / Safari ile açın
2. **Ana ekrana ekle** / **Add to Home Screen**
3. Defter, uygulama gibi tam ekran açılır

## Yerelde deneme

Modüller ve service worker için basit bir HTTP sunucu gerekir:

```bash
npx --yes serve .
```

veya VS Code / Cursor Live Server ile `index.html` açın.

## Gizlilik

Sunucuya not gönderilmez. Her şey tarayıcınızda kalır. Cihaz değiştirirken Ayarlar → Dışa aktar ile yedek alın.

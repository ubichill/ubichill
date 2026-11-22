---
"@ubichill/backend": patch
"@ubichill/bff": patch
---

World Editor のコントロールパネルから、エディタの画面を撮ってサムネイルにできるようにする（「画面から撮る」で 16:9 の枠を出し、部屋で見える通りに描いて撮る）。ほかのサーバーのエディタも写せるように、上げた画像（`/api/v1/assets/*.webp`）と公式ワールドのサムネイル（`/world-thumbnails/*`）を、どのオリジンからも読めるようにする。

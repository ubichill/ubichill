---
"@ubichill/core-components": minor
"@ubichill/shared": minor
"@ubichill/cli": patch
"@ubichill/backend": patch
---

ワールドを読む側（部屋・サーバー・ほかのサーバーのワールドを読むとき）は、この版が知らない本体の部品（`core:*`）と、本体の部品の知らない項目を断らずに残し、使わないようにする。新しい ubichill で部品を足しても、ワールドがこの版以降のサーバーで開けなくなることはない。書く側は今まで通り確かめる。エディタは確認の一覧に出し、`ubichill publish` は公開を止め、`ubichill dev` は警告を出す。部屋では、表示されない部品があることをコンソールに出す。core-components に、知らない項目を捨てて読む `readCoreData`・`readCoreComponentData` と、書く側で使う `unknownCoreComponentKeys` を足す。

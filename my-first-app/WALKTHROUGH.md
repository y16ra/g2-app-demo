# my-first-app 構築手順まとめ

[公式クイックスタート](https://hub.evenrealities.com/docs/get-started/quickstart/first-app)を参考に、Even Hub G2アプリを作成した手順の記録。

## 1. プロジェクト作成

```bash
npm create vite@latest my-first-app -- --template vanilla-ts
cd my-first-app
npm install
```

## 2. Even Hub SDKの導入

```bash
npm install @evenrealities/even_hub_sdk@latest
```

## 3. Even Hubマニフェストの作成

```bash
evenhub init
```

`app.json`(package_id・バージョン・permissions等のメタデータ)が生成される。

## 4. main.ts の実装

クイックスタートの「Write main.ts」に沿って、`src/main.ts`をEven Hub SDKの実装に置き換え。

- `waitForEvenAppBridge()`でブリッジ初期化を待つ
- 576×288いっぱいのtext containerを`createStartUpPageContainer`で描画
- `onEvenHubEvent`でタップ/ダブルタップを購読し、カウントアップ・終了処理を実装

あわせて、Viteテンプレートの未使用ファイル(`counter.ts`、`style.css`、`assets/`配下の画像、`public/icons.svg`)を削除。

## 5. シミュレータでの動作確認とハマりポイント

```bash
npm install -g @evenrealities/evenhub-simulator
npm run dev
evenhub-simulator -g http://localhost:5173
```

**問題**: シミュレータ上でクリック/ダブルクリックしても反応しなかった。

**調査**: `evenhub-simulator --automation-port <PORT>`でHTTP自動化APIを有効化し、実際に何が起きているかを直接観測した。

```bash
evenhub-simulator -g http://localhost:5173 --automation-port 9898
curl -s -X POST http://127.0.0.1:9898/api/input -H "Content-Type: application/json" -d '{"action":"click"}'
curl -s "http://127.0.0.1:9898/api/console"
```

クリックを送るたびに`/api/console`で観測されたイベントは以下の通り(いずれも`textEvent`ではなく`sysEvent`):

```json
// クリック(シングルタップ)
{"jsonData":{"eventSource":1},"sysEvent":{"eventSource":1}}

// ダブルクリック(ダブルタップ)
{"jsonData":{"eventType":3,"eventSource":1},"sysEvent":{"eventType":3,"eventSource":1}}
```

`OsEventTypeList`は`CLICK_EVENT=0`・`DOUBLE_CLICK_EVENT=3`なので、`eventType:3`はダブルクリックに一致する。シングルクリックの方は`eventType`キー自体が省略されており(SDKが`0`を`undefined`に正規化する挙動)、`textEvent`は一度も観測されなかった。

**原因判明**: 公式クイックスタートのサンプルコードは、クリックが常に`event.textEvent`(コンテナ単位のイベント、`containerID`付き)として届く前提だった。

```ts
// 公式サンプルの前提(動かなかったコード)
bridge.onEvenHubEvent((event) => {
  const textEvent = event.textEvent
  if (!textEvent || textEvent.containerID !== 1) return   // ← textEventは常にundefinedなので毎回ここでreturnしていた

  switch (textEvent.eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      // ...カウントアップ処理...
```

しかし`evenhub-simulator` v0.7.1では、StartUpPage(ルートページ)いっぱいに置いた単一のtext containerへのタップは`event.sysEvent`(`containerID`を持たない、`eventType`のみ)として配信されていた。そのため`event.textEvent`は常に`undefined`となり、ガード節で毎回早期returnしてクリックが無視されていた。`containerID`によるコンテナの絞り込みは、ルートページに置いたコンテナが1つだけの場合はそもそも不要とも言える。

**修正**: `onEvenHubEvent`内で`event.textEvent`と`event.sysEvent`の両方を見るように変更。`textEvent`が存在する場合のみ`containerID`を確認し、どちらの形でイベントが来ても`eventType`でルーティングできるようにした(`file:src/main.ts:46-51`)。

```ts
bridge.onEvenHubEvent((event) => {
  const source = event.textEvent ?? event.sysEvent
  if (!source) return
  if (event.textEvent && event.textEvent.containerID !== 1) return

  switch (source.eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      // ...カウントアップ処理...
```

実機では`textEvent`経由で届く可能性も残っているため、どちらの経路でも動くようにしてハードウェアとの互換性も保っている。

### 実機での再検証

シミュレータの`--automation-port`のような外部APIは実機には無いため、代わりにVite dev serverのHMR用WebSocketを使ってイベントをMac側のターミナルに中継する一時的な仕組みを作った。

```ts
// vite.config.ts (デバッグ用、検証後は削除)
function evenHubEventLogger(): Plugin {
  return {
    name: 'evenhub-event-logger',
    configureServer(server) {
      server.ws.on('evenhub:event', (data) => {
        console.log('[evenhub event]', JSON.stringify(data, null, 2))
      })
    },
  }
}
```

```ts
// main.ts の onEvenHubEvent 内(デバッグ用、検証後は削除)
import.meta.hot?.send('evenhub:event', event)
```

`npm run dev -- --host`でLAN公開し、実機のEven Hubコンパニオンアプリから接続してタップ/ダブルタップ/スワイプを実行、Mac側のターミナルに出力されたログを確認した。

```json
// クリック(シングルタップ)
{ "sysEvent": { "eventSource": 1 } }

// ダブルクリック(ダブルタップ)
{ "sysEvent": { "eventType": 3, "eventSource": 1 } }

// 上スワイプ
{ "textEvent": { "containerID": 1, "containerName": "main", "eventType": 1 } }

// 下スワイプ
{ "textEvent": { "containerID": 1, "containerName": "main", "eventType": 2 } }
```

**結論**:

- クリック/ダブルクリックは実機でも`sysEvent`(`containerID`なし)として届く。シミュレータだけの挙動ではなく、`event.textEvent ?? event.sysEvent`の修正は実機でも必須だった。
- 一方でスワイプ(上下スクロール、`eventType:1`/`2`)は`textEvent`(`containerID`付き)として届いた。同じ`onEvenHubEvent`でも、操作の種類によって`textEvent`/`sysEvent`のどちらに乗るかが変わる。

検証後、デバッグ用の`vite.config.ts`と`import.meta.hot?.send`呼び出しは削除済み。

## 6. ドキュメント整備

- リポジトリルートに`README.md`(セットアップ手順、ハマりポイントの記録)
- リポジトリルートに`CLAUDE.md`(コマンド一覧、アーキテクチャ、上記の既知の癖)

## 7. コミット・PR・レビュー対応

```bash
git checkout -b my-first-app-quickstart
git add README.md CLAUDE.md my-first-app
git commit -m "Add my-first-app Even Hub quickstart and docs"
git push -u origin my-first-app-quickstart
gh pr create ...
```

Gemini Code Assistのレビューで2件指摘を受け、対応:

1. `app.json`の未使用`network`/`location`権限を削除(`"permissions": []`)
2. `main.ts`で`createStartUpPageContainer`失敗時、`console.error`ではなく`throw new Error(...)`で処理を止めるように変更

修正をコミット・プッシュし、各インラインコメントに返信。PRマージ後、`main`をチェックアウトして最新化。

## 8. 実機での動作確認

```bash
ipconfig getifaddr en0                              # LAN上の自分のIPを確認
evenhub qr --url "http://<自分のIP>:5173"             # 実機用QRコードを生成
npm run dev -- --host                                # --host でLANに公開
```

生成したQRコードをEven Hubのコンパニオンアプリでスキャンし、実機での表示・動作を確認。

## 9. ビルドとパッケージング

```bash
npm run build                                       # tsc + vite build → dist/
npx evenhub pack app.json dist -o g2-demo.ehpk       # .ehpk にパッケージング
```

`.ehpk`ファイルはビルド成果物なので`my-first-app/.gitignore`に`*.ehpk`を追加してgit管理外に。

`app.json`の`package_id`を`com.example.g2demo`から`dev.y16ra.g2demo`に変更した際は、`npm run build` → `npx evenhub pack ...`を再実行してパッケージを作り直す。

## 10. 配布

`.ehpk`ファイルをEven Hub developer portalに提出して審査・公開を依頼する(Webポータル上での手動アップロードが必要。CLIには提出コマンドは無い)。

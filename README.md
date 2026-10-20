# g2-app-demo

Even Hub G2(スマートグラス)向けアプリのデモ・練習用リポジトリ。

## プロジェクト構成

- [`my-first-app/`](./my-first-app) — Vite (vanilla-ts) + `@evenrealities/even_hub_sdk` で作った最初のEven Hubアプリ（v1.0.1）。
  タップまたは上スワイプで +1、下スワイプで −1（0 で止まる）、ダブルタップで終了確認ダイアログ。カウントは保存され、開き直すと続きから始まる。
  [公式クイックスタート](https://hub.evenrealities.com/docs/get-started/quickstart/first-app)を参考に作成。

## my-first-app のセットアップ

```bash
cd my-first-app
npm install
npm run dev                 # Vite dev server (http://localhost:5173)
```

別ターミナルでシミュレータを起動して動作確認する。

```bash
npm install -g @evenrealities/evenhub-simulator
evenhub-simulator -g http://localhost:5173
```

`evenhub-simulator` 0.9.5 では URL は位置引数（`evenhub-simulator http://localhost:5173 --automation-port 9898`）。この版の `-g` は glow 表示のフラグ。上の `-g <URL>` は、このリポジトリを最初に検証した 0.7.x の書き方。

シミュレータのウィンドウ内でクリック/ダブルクリックすると、実機のタップ/ダブルタップ操作をエミュレートできる。
通常のブラウザタブでmain.tsを開いてマウスクリックしても反応しない(SDKはDOMクリックではなく、シミュレータ/実機からブリッジ経由で届くイベントのみを購読しているため)。

## カウント操作と保存 (v1.0.1)

- シングルタップ、または上スワイプ（`OsEventTypeList.SCROLL_TOP_EVENT`）で +1。
- 下スワイプ（`OsEventTypeList.SCROLL_BOTTOM_EVENT`）で −1。回数のカウンタなので 0 より小さくしない。下スワイプは 1 戻す操作。
- ダブルタップで終了確認ダイアログ（従来どおり）。
- 値は SDK の `bridge.getLocalStorage` / `bridge.setLocalStorage` を優先して保存する（追加の permission は不要）。これは Even Hub の端末側キーバリュー。ブリッジが無い・失敗した・値が無いときは `window.localStorage` にミラーしたコピーへフォールバックする。両方使えないときは 0 から始まり、その起動中の表示更新は続ける。二つの保存先が食い違ったときは、更新のたびに増やす revision が大きい方を採用する。`evenhub-simulator` 0.9.5 ではブリッジ側はプロセスが生きている間だけ残り、プロセスを落として開き直した場合は localStorage 側から復帰する。

SDK 0.0.12 の `OsEventTypeList` では `SCROLL_TOP_EVENT = 1`、`SCROLL_BOTTOM_EVENT = 2`。実機ログの上スワイプ `eventType: 1` / 下スワイプ `eventType: 2`（`textEvent`、`containerID: 1`）と一致する。数値はコードに直書きせず、この定数で判定している。

## ハマったポイント: `event.textEvent` ではなく `event.sysEvent` が届く

公式クイックスタートのサンプルコードは、text containerへのタップが `event.textEvent`(`containerID` 付き)として届く前提だった。しかし `evenhub-simulator` v0.7.1 で実際に検証すると、StartUpPage(ルートページ)いっぱいに置いた単一のtext containerへのタップは `event.sysEvent`(`containerID` を持たない、`eventType` のみ)として配信されていた。

そのままサンプル通り `if (!textEvent || textEvent.containerID !== 1) return` と書くと、`textEvent` が常に `undefined` になり、クリック/ダブルクリックが常に無視される。

`src/main.ts` の `onEvenHubEvent` では、`event.textEvent ?? event.sysEvent` の両方を見てイベントタイプを判定するようにして対応している。

検証には `evenhub-simulator --automation-port <PORT>` で立ち上げたシミュレータのHTTP自動化API(`/api/input` でクリック送信、`/api/console` で実際に届いたイベントJSONを確認)を使った。実機では `textEvent` 経由で届く可能性もあるため、両対応にしてハードウェアとの互換性も保っている。

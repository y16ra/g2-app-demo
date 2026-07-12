# g2-app-demo

Even Hub G2(スマートグラス)向けアプリのデモ・練習用リポジトリ。

## プロジェクト構成

- [`my-first-app/`](./my-first-app) — Vite (vanilla-ts) + `@evenrealities/even_hub_sdk` で作った最初のEven Hubアプリ。
  タップでカウントアップ、ダブルタップで終了確認ダイアログを出すサンプル。

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

シミュレータのウィンドウ内でクリック/ダブルクリックすると、実機のタップ/ダブルタップ操作をエミュレートできる。
通常のブラウザタブでmain.tsを開いてマウスクリックしても反応しない(SDKはDOMクリックではなく、シミュレータ/実機からブリッジ経由で届くイベントのみを購読しているため)。

## ハマったポイント: `event.textEvent` ではなく `event.sysEvent` が届く

公式クイックスタートのサンプルコードは、text containerへのタップが `event.textEvent`(`containerID` 付き)として届く前提だった。しかし `evenhub-simulator` v0.7.1 で実際に検証すると、StartUpPage(ルートページ)いっぱいに置いた単一のtext containerへのタップは `event.sysEvent`(`containerID` を持たない、`eventType` のみ)として配信されていた。

そのままサンプル通り `if (!textEvent || textEvent.containerID !== 1) return` と書くと、`textEvent` が常に `undefined` になり、クリック/ダブルクリックが常に無視される。

`src/main.ts` の `onEvenHubEvent` では、`event.textEvent ?? event.sysEvent` の両方を見てイベントタイプを判定するようにして対応している。

検証には `evenhub-simulator --automation-port <PORT>` で立ち上げたシミュレータのHTTP自動化API(`/api/input` でクリック送信、`/api/console` で実際に届いたイベントJSONを確認)を使った。実機では `textEvent` 経由で届く可能性もあるため、両対応にしてハードウェアとの互換性も保っている。

# 共有機能の運用

共有URLは通常のトップページを開く。WorkerはHTMLのメタデータを付け、画像を要求されたときだけ生成する。
既存のCloudflareアカウントのWorkers Paidを使用する。Browser RunやDurable Objectsは使わない。

## ビルドと配信

Node.js 22系で `npm ci` を実行する。

- `npm run build`：単体HTMLの`index.html`を生成する。画像生成コードやWASMは含めない。
- `npm run build:external`：静的サイトの`dist-external/`とWorkerの`dist-worker/`を生成する。
- `npx wrangler dev --local`：ローカルのWorker、ASSETS、R2を起動する。
- `npm run preview`：Cloudflareへプレビュー可能なWorkerバージョンをアップロードする。本番の配信バージョンは切り替えない。
- `npm run deploy`：既存Workerへ公開する。Wranglerのビルド設定が配信用ビルドを実行する。

Wranglerの`main`はビルド済みWorker、`ASSETS`は`dist-external/`。
Workerを先に呼ぶパスは `/` と `/og.png` のみ。時間別JSONなどは従来の静的配信を使う。
`dist-worker/`、ソース、検証記録は公開アセットに含めない。フォントデータとWASMはWorker内部の依存になる。
MathJax本体・4書体とEuler拡張は4.1.3、resvg WASMは2.6.2に固定する。

ローカルサーバーの実行中に別プロセスで`dist-external/`を再生成した場合は、検証前にサーバーを再起動してアセット目録を読み直す。

## R2

`OG_IMAGES`に非公開の`formula-clock-og`を割り当てる。
`wrangler dev --remote`は`preview_bucket_name`の`formula-clock-og-preview`を使う。
アップロードしたバージョンのプレビューURLはそのバージョンの通常のbindingを使用する。

新しいアカウントへ移す場合の作成手順：

```sh
npx wrangler r2 bucket create formula-clock-og
npx wrangler r2 bucket create formula-clock-og-preview
npx wrangler r2 bucket lifecycle add formula-clock-og og-30-days og/ --expire-days 30
npx wrangler r2 bucket lifecycle add formula-clock-og-preview og-30-days og/ --expire-days 30
```

公開R2 URLやカスタムドメインは設定しない。オブジェクトはWorkerが読む。
キーは `og/<描画版>/<HHMMSS>-<書体>-<数字>-<除算>.png`。
描画版はレンダラー・共有設定・フォント依存・式データなどのビルド時ハッシュから求める。
ライフサイクルは保存から30日で期限切れにする。最終アクセス日時を延長する方式ではない。
Cloudflareの非同期削除後、要求があれば現在のコード・データで再生成する。

## 応答と失敗時の動作

R2ヒット時はそのPNGを返し、未保存時だけMathJax → SVG → resvg → PNGを実行する。
字形の0と等号を測って軸補正し、書体・数字スタイルごとのエンジンを分ける。
同じエンジンの変換と同じ画像の生成要求はそれぞれ直列化・共有する。
別のWorkerインスタンスで重複生成されても、同じキーへ同じ画像を保存できる。

正常画像は`Cache-Control: public, max-age=86400`。ETag・HEAD・条件付きGETに対応する。
HTMLはクエリごとにメタデータを作り、静的HTMLのETagを引き継がず`no-cache`にする。
パラメータなし・不正な時刻・データ取得／描画失敗では、ビルドに同梱したロゴPNGを返す。
取得・描画の待機上限は8秒、キャッシュ書き込みは1秒。通常の処理エラーはロゴへ退避し、R2書き込みだけの失敗なら生成済み画像を返す。
代替画像は60秒だけキャッシュし、R2の正常画像キーには保存しない。

`event: "og"`の構造化ログに、描画版、cache（hit / miss / coalesced）、生成時間、バイト数、失敗理由を残す。
ログのelapsedMsは入出力を含む経過時間で、課金CPU時間とは別。CPU時間はCloudflare側の計測で確認する。
CloudflareのリモートプレビューのログはCPU時間と成否を返すが、ピークメモリの数値は返さない。
メモリの数値を記録する場合は、ローカルworkerdのJSヒープとWASM領域を分け、Cloudflare上のピーク値とは区別する。
SNS側が一度取得したカードを独自に保持する場合、その更新時期はアプリから制御できない。

## 検証

```sh
npm test
npm run build
npm run build:external
npm run test:og
python tests/share.browser.py --url http://127.0.0.1:8787/
python tests/og-parity.browser.py --url http://127.0.0.1:8787/
python tests/browser.test.py --url http://127.0.0.1:8787/ --screenshots
```

`test:og`の描画テストは128ケースのPNG・測定値を`test-results/share-og/`へ保存する。
字形比較はその測定値と、実際にCDNから取得したMathJaxの字形パス・軸・viewBoxを照合する。
ブラウザ検証はChromium / Firefox / WebKitを選択でき、実行コマンド・ブラウザとMathJaxの版・取得URLを記録する。
CDN検証にローカル互換フォントを代用しない。ログ・実行結果・確認用画像はGit対象外の`test-results/`に保存する。

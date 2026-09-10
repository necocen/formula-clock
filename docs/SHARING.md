# 共有機能の運用

共有URLは`/s/<英数字10文字>`。WorkerはKVに保存した時刻・表示設定・式木をHTMLへ埋め込み、画像を要求されたときだけ生成する。
既存のCloudflareアカウントのWorkers Paidを使用する。Browser RunやDurable Objectsは使わない。

## ビルドと配信

Node.js 22系で `npm ci` を実行する。

- `npm run build`：単体HTMLの`index.html`を生成する。画像生成コードやWASMは含めない。
- `npm run build:external`：静的サイトの`dist-external/`とWorkerの`dist-worker/`を生成する。
- `npx wrangler dev --local`：ローカルのWorker、ASSETS、KV、R2を起動する。
- `npm run preview`：Cloudflareへプレビュー可能なWorkerバージョンをアップロードする。本番の配信バージョンは切り替えない。
- `npm run deploy`：既存Workerへ公開する。Wranglerのビルド設定が配信用ビルドを実行する。

Wranglerの`main`はビルド済みWorker、`ASSETS`は`dist-external/`。
Workerを先に呼ぶパスは`/`・`/og.png`・`/s/*`・`/api/shares`。時間別JSONなどは従来の静的配信を使う。
`dist-worker/`、ソース、検証記録は公開アセットに含めない。フォントデータとWASMはWorker内部の依存になる。
MathJax本体・4書体とEuler拡張は4.1.3、resvg WASMは2.6.2に固定する。

ローカルサーバーの実行中に別プロセスで`dist-external/`を再生成した場合は、検証前にサーバーを再起動してアセット目録を読み直す。

## KVと共有リンク

`SHARES`に`formula-clock-shares`を割り当て、`share/<ID>`へ検証済みJSONを保存する。
`wrangler dev --remote`は`preview_id`の`formula-clock-shares-preview`を使う。
バージョンのプレビューURLは、そのバージョンの通常のbindingを使う。

```sh
npx wrangler kv namespace create formula-clock-shares
npx wrangler kv namespace create formula-clock-shares-preview
```

移設時は作成結果のIDを`wrangler.jsonc`の`id`・`preview_id`へ設定する。
リンクを長く保つため、共有データに有効期限は設定しない。保存済みレコードを更新するAPIも設けない。
新規共有ごとにランダムなIDを作り、サーバー全体での同一パラメータの重複排除は行わない。
ブラウザ内では直近に共有した同じスナップショットのURLを再利用し、開いた共有URLもそのまま再共有できる。
ハッシュと短縮IDの索引を追加すると、同時作成や結果整合性の扱いが増えるため、現時点では採用しない。
保存容量だけでなく書き込み・読み取り数も[KVの料金](https://developers.cloudflare.com/kv/platform/pricing/)の対象となる。

`POST /api/shares`はKV書き込みの完了後にIDを返す。IDの事前検索はせず、存在しないキーのキャッシュを作らない。
KVには[結果整合性と存在しないキーのキャッシュ](https://developers.cloudflare.com/kv/concepts/how-kv-works/)があり、
別の地域では作成直後の共有リンクが一時的に見えない場合がある。書き込み完了は全地域での即時可視性を保証しない。
未検出は404、KVの読み取り失敗は503とし、保存済みの式を現在データで置き換えない。
エラーは`no-store`・`Retry-After: 60`とし、HTMLには再読み込みとトップページへのリンクを出す。
作成失敗では画面を停止したまま再試行を可能にし、未保存のURLを共有しない。

共有時にKV保存を待ってユーザー操作の有効期間が切れた場合は、生成済みURLと共有・コピーのボタンを表示する。
時刻・表示設定の操作があれば保存要求の待機を中止し、古いURLのダイアログやコピーを実行しない。

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
新形式のキーは`og/<描画版>/shares/<ID>.png`。同じ時刻・設定でも式木が違う共有画像を混同しない。
旧クエリURLは`og/<描画版>/<HHMMSS>-<書体>-<数字>-<除算>.png`を使う。
描画版はレンダラー・共有設定・フォント依存・式データなどのビルド時ハッシュから求める。
ライフサイクルは保存から30日で期限切れにする。最終アクセス日時を延長する方式ではない。
Cloudflareの非同期削除後、要求があれば現在の描画コードとKVに保存した式木で再生成する。
旧クエリURLだけは現在の式データを使う。画像の期限切れで共有リンク自体は消えない。

## 応答と失敗時の動作

R2ヒット時はそのPNGを返し、未保存時だけMathJax → SVG → resvg → PNGを実行する。
字形の0と等号を測って軸補正し、書体・数字スタイルごとのエンジンを分ける。
同じエンジンの変換と同じ画像の生成要求はそれぞれ直列化・共有する。
別のWorkerインスタンスで重複生成されても、同じキーへ同じ画像を保存できる。

正常画像は`Cache-Control: public, max-age=86400`。ETag・HEAD・条件付きGETに対応する。
HTMLは共有状態ごとにメタデータを作り、静的HTMLのETagを引き継がず`no-cache`にする。
旧画像URLのパラメータなし・不正な時刻・データ取得失敗と、両形式の描画失敗では、ビルドに同梱したロゴPNGを返す。
新形式のIDが未検出・KVが利用不能の場合は404／503を返し、別の時刻の画像へ置き換えない。
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
python tests/kv-share.browser.py --url http://127.0.0.1:8787/ --browser chromium --output-dir test-results/kv-share-chromium
python tests/og-parity.browser.py --url http://127.0.0.1:8787/
python tests/browser.test.py --url http://127.0.0.1:8787/ --screenshots
```

`test:og`の描画テストは128ケースのPNG・測定値を`test-results/share-og/`へ保存する。
字形比較はその測定値と、実際にCDNから取得したMathJaxの字形パス・軸・viewBoxを照合する。
ブラウザ検証はChromium / Firefox / WebKitを選択でき、実行コマンド・ブラウザとMathJaxの版・取得URLを記録する。
CDN検証にローカル互換フォントを代用しない。ログ・実行結果・確認用画像はGit対象外の`test-results/`に保存する。

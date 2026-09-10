# Formula Clock

時刻の4桁（HHMM）から、秒（SS）を表す数式を表示する時計です。
数字は同じSVG要素のまま移動・拡縮し、式がない秒は淡いHH:MM:SSへ切り替わります。

## 起動

Node.js 22系を使用します。アプリ・Worker・ビルドツールのソースはTypeScriptです。

```sh
npm ci
npm run build
```

生成された`index.html`をブラウザで開けます。MathJax 4.1.3とフォントはCDNから読み込むため、インターネット接続が必要です。

共有URLとOG画像を含むサイトをローカルで動かす場合：

```sh
npm run build:external
npx wrangler dev --local
```

`dist-external/`に配信用HTMLと24時間分のJSON、`dist-worker/`にOG画像生成用Workerを生成します。
Cloudflareへのプレビュー・公開・KV／R2設定は[共有機能の運用](docs/SHARING.md)を参照してください。

## 使い方

右上の設定からフォント、数字のスタイル、除算のスタイル、音量を変更できます。
フォントはSTIX Two / Termes / Fira / Euler、数字はLining / Oldstyleを独立して選びます。初期値はSTIX Two + Oldstyle + 分数です。
表示設定と時報のオン／オフ・音量はブラウザに保存します。

秒の目盛りや時刻指定からプレビューでき、Play / Pauseで再生・一時停止、「現在時刻へ」で通常の時計に戻ります。
共有ボタンを押すと表示中の秒で停止し、時刻・フォント・表示形式・式木をKVへ保存した短いURLを共有できます。
一時停止後や共有ボタンにカーソル・フォーカスが来たときにURLを先に準備し、保存が済んでいればすぐ共有を開きます。
式データが更新されても共有時の数式を再現し、受け取った人の保存済み設定は書き換えません。
再生や設定変更の操作で、アドレスは`/`へ戻ります。共有URLの形式は[FORMAT.md](FORMAT.md#9-共有urlとog画像)に記載しています。

| キー | 操作 |
|---|---|
| M | 時報のオン／オフ |
| F | 全画面表示の切り替え |
| L | 現在時刻へ戻る |
| Space | プレビューの再生・一時停止 |

全画面ボタンはブラウザが対応・許可している場合に表示します。
時報は117風の秒音・予告音・時報音です。自動再生が制限されている場合もオンの選択を保ち、次のクリックやキー操作で再開します。

設定の「詳細」には、次のアニメーション設定があります。

- **記号をなめらかに動かす**：同じ持ち場の四則記号などを次の式へ引き継ぎます。
- **分数・√・括弧も動かす**：分数線と、同じサイズの根号・括弧を引き継ぎます。
- **四則記号を変形する**：同じ桁の境界の＋・−・×・÷を回転やフェードでつなぎます。

下の2項目は「記号をなめらかに動かす」がオンの場合に動作し、それぞれ独立して選べます。
親項目をオフにしても選択値は保持します。初期設定はいずれもオンです。保存済みのオン／オフはそのまま使います。

## UIの言語

ブラウザの最優先言語が日本語なら日本語、それ以外は英語になります。文言は`i18n.ts`で管理しています。
日本語UIでも「フォント」「LICENSE」「Loading」やPlay / Pauseなど、一般的な表記を使います。
現在時刻への復帰やショートカットの説明は、意味が伝わる日本語にしています。
言語によって時計の数値・フォント・共有URL・保存設定は変わりません。

ライセンス画面の説明は日本語のみで、ライセンス原文をそのまま掲載します。

## ソースの構成

| ファイル | 役割 |
|---|---|
| `_head.html` / `app.ts` | 画面・操作・時計・アニメーション・時報 |
| `i18n.ts` | 日英のUI文言 |
| `expression.ts` / `data.ts` | ASTからのTeX生成、式データの取得 |
| `display.ts` / `typesetter.ts` / `symbols.ts` | 表示設定、組版、数字と記号の配置・同一性 |
| `share.ts` / `worker/` | 共有URL、HTMLメタデータ、OG画像の描画・キャッシュ |
| `build.ts` / `tools/build-worker.ts` | 単体HTML・配信用アセット・Workerのビルド |
| `types.ts` / `api.d.ts` / `browser-types.ts` | 共通・公開API・SVGレイアウトの型 |
| `browser.ts` / `globals.d.ts` | ブラウザの公開APIと起動順序 |
| `tools/solver.ts` / `tools/generate.ts` | オフラインの式探索・データ生成 |
| `data/expressions.json` | 事前生成した1日分の式データ |
| `tests/` | Nodeとブラウザのテスト |

`tsconfig.json`の`strict`でソースを型チェックし、esbuildでブラウザ用JavaScriptをHTMLへ埋め込みます。Nodeのツールと既存のJavaScriptテストはtsxでTypeScriptソースを読み込みます。ブラウザにTypeScriptの実行環境やnpmライブラリを追加する必要はありません。

`index.html`は生成物です。原本を編集して`npm run build`で更新してください。
`npm run generate`は全日の式を再探索する処理で、通常の表示変更やビルドには不要です。

## 検証

```sh
npm run typecheck
npm test
npm run build
npm run build:external
npm run test:og
```

`npm run typecheck`はTypeScriptの型チェックだけを実行します。`npm test`と両ビルドにも型チェックを含めています。
`npm test`は式・データ・URL・ビルド・キャッシュなどを検証します。配布フォントの実際の読み込みはブラウザで確認します。

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-test.txt
python -m playwright install chromium
python tests/browser.test.py --browser chromium
```

ブラウザテストの既定はMathJax 4.1.3のCDN経路です。`--local-mathjax`を使う互換テストとは区別してください。
HTTP配信の共有・多言語UIは、ローカルWorkerを起動して確認できます。

```sh
python tests/share.browser.py --url http://127.0.0.1:8787/ --browser chromium
python tests/i18n.browser.py --url http://127.0.0.1:8787/ --browser chromium --output-dir test-results/i18n
```

ログ・実行結果JSON・確認用スクリーンショットは、Git対象外の`test-results/`に保存します。
変更内容に応じた確認項目は[ACCEPTANCE.md](docs/ACCEPTANCE.md)を参照してください。

## ドキュメント

- [FORMAT.md](FORMAT.md)：式データ、表示設定、プロバイダーAPI、共有URLの仕様
- [SHARING.md](docs/SHARING.md)：Cloudflare・R2・OG画像の運用
- [ACCEPTANCE.md](docs/ACCEPTANCE.md)：変更時に確認する動作
- [AGENTS.md](AGENTS.md)：実装で守る要点と作業方針

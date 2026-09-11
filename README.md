# Formula Clock

時刻の4桁（HHMM）から、秒（SS）を表す数式を表示する時計です。
数字は同じSVG要素のまま移動・拡縮し、式がない秒は淡いHH:MM:SSへ切り替わります。

## 起動

Node.js 22系の22.12.0以上を使用します（推奨版は`.node-version`）。アプリ・Worker・ビルドツールのソースはTypeScriptです。

```sh
npm ci
npm run build
```

生成された`dist/standalone/index.html`をブラウザで開けます。MathJax 4.1.3とフォントはCDNから読み込むため、インターネット接続が必要です。

共有URLとOG画像を含むサイトをローカルで動かす場合：

```sh
npm run build:external
npm run dev
```

`dist/site/`に配信用HTMLと24時間分のJSON、`dist/worker/`にOG画像生成用Workerを生成します。
Cloudflareへのプレビュー・公開・KV／R2設定は[共有機能の運用](docs/SHARING.md)を参照してください。

## 使い方

右上の設定からフォント、数字のスタイル、除算のスタイル、音量を変更できます。
フォントはSTIX Two / Termes / Fira / Euler、数字はLining / Oldstyleを独立して選びます。除算は分数・÷・/ の3種類です。初期値はSTIX Two + Oldstyle + 分数です。
表示設定と時報のオン／オフ・音量はブラウザに保存します。

秒の目盛りや時刻指定で一時停止し、← / →キーで1秒ずつ前後へ移動できます。分や日付の境界もまたげます。操作欄の「現在時刻へ」で通常の時計に戻ります。Spaceでも表示中の秒で一時停止し、もう一度押すと現在時刻へ戻ります。
共有ボタンを押すと表示中の秒で停止し、時刻・フォント・表示形式・式木をKVへ保存する短いURLを共有できます。
URLのIDが発行されたら共有を開き、KV保存の完了は待ちません。一時停止後や共有ボタンにカーソル・フォーカスが来たときにもURLを先に準備します。
式データが更新されても共有時の数式を再現し、受け取った人の保存済み設定は書き換えません。
時刻の移動や設定変更の操作で、アドレスは`/`へ戻ります。共有URLの形式は[docs/FORMAT.md](docs/FORMAT.md#9-共有urlとog画像)に記載しています。

| キー  | 操作                                 |
| ----- | ------------------------------------ |
| M     | 時報のオン／オフ                     |
| F     | 全画面表示の切り替え                 |
| L     | 現在時刻へ戻る                       |
| ← / → | 一時停止中に1秒戻る／進む            |
| Space | 表示中の秒で一時停止／現在時刻へ戻る |

全画面ボタンはブラウザが対応・許可している場合に表示します。
時報は117風の秒音・予告音・時報音です。自動再生が制限されている場合もオンの選択を保ち、次のクリックやキー操作で再開します。

設定の「詳細」には、次のアニメーション設定があります。

- **記号をなめらかに動かす**：同じ持ち場の四則記号などを次の式へ引き継ぎます。
- **分数・√・括弧も動かす**：分数線と、同じサイズの根号・括弧を引き継ぎます。
- **四則記号を変形する**：同じ桁の境界の＋・−・×・÷を回転やフェードでつなぎます。

下の2項目は「記号をなめらかに動かす」がオンの場合に動作し、それぞれ独立して選べます。
親項目をオフにしても選択値は保持します。初期設定はいずれもオンです。保存済みのオン／オフはそのまま使います。

## UIの言語

ブラウザの最優先言語が日本語なら日本語、それ以外は英語になります。文言は`src/shared/i18n.ts`で管理しています。
日本語UIでも「フォント」「LICENSE」「Loading」など、一般的な表記を使います。
現在時刻への復帰やショートカットの説明は、意味が伝わる日本語にしています。
言語によって時計の数値・フォント・共有URL・保存設定は変わりません。

ライセンス画面の説明は日本語のみで、ライセンス原文をそのまま掲載します。
本文・出典・確認済みバージョンは`licenses/`で管理し、ビルド時に画面へ組み込みます。`npm run generate:licenses`でライセンス部分だけを生成できます。更新手順は[ライセンス表示の管理](licenses/README.md)を参照してください。

## ディレクトリ構成

```text
src/
  browser/       画面・CSS・組版・ブラウザ操作
  shared/        AST・表示設定・データ取得・共有URL・共通の型
  worker/        共有API・HTMLメタデータ・OG画像
  api.d.ts       公開APIの型
public/          配信用の静的設定（_headers）
licenses/        ライセンス本文・出典・表示テンプレート
tools/           ビルド・データ生成／取り込み・テスト実行
data/            採用済み式データ・JSON Schema・形式サンプル
tests/
  unit/          Nodeによる単体・データ検証
  build/         単体HTML・配信用ビルドの検証
  og/            OG画像描画・workerdの統合テスト
  browser/       MathJax 4 CDNを使うPlaywrightテスト
  compat/        手元のMathJax 3・フォントを使う互換性確認
  fixtures/      固定したテスト入力
  helpers/       厳密計算・レポート出力などの補助コード
docs/            仕様・運用・確認項目・説明用の見本画像
dist/            ビルド出力（Git管理外）
test-results/    実行結果・スクリーンショット（Git管理外）
```

`src/browser/app.html`が画面の原本です。ビルドは`<!-- clock-licenses -->`へライセンス表示、`<!-- clock-scripts -->`へ公開APIの準備・データ設定・アプリを順に挿入し、単体版を`dist/standalone/index.html`、配信版を`dist/site/index.html`へ生成します。原本を編集して`npm run build`で更新してください。

`dist/`と`test-results/`は削除・再生成できるためGitへ入れません。`data/expressions.json`は採用済みの入力データ、`docs/images/`は説明用の見本なのでGit管理します。テスト結果を`tests/`へ出力しないでください。

`npm run generate`は全日の式を再探索し、現在の採用データを上書きします。通常の表示変更やビルドには不要です。外部データは`npm run import:data -- DIRECTORY`で取り込みます。出典と手順は[data/README.md](data/README.md)を参照してください。

## 検証

整形は[Oxfmt](https://oxc.rs/docs/guide/usage/formatter)、lintは[Oxlint](https://oxc.rs/docs/guide/usage/linter)を使います。
TypeScript・JavaScriptの原本とテスト、HTML内のCSS、JSON設定、Markdownを整形します。2スペース・シングルクォート・100文字幅を基準にし、importの自動並べ替えは行いません。
生成物・採用済み式データ・形式サンプル・ロックファイルは整形対象外です。HTMLやTypeScriptの整形後は`npm run build`で出力を更新します。

```sh
npm run format       # 原本を一括整形
npm run lint:fix     # 安全なlint自動修正（残った指摘は手で修正）
npm run check        # 整形確認・lint・TypeScript型チェック
```

`npm run format:check`と`npm run lint`も単独で実行できます。Oxlintはcorrectnessルールと、厳密な比較・`const`の使用・`var`の禁止をチェックし、警告も失敗として扱います。`null`と`undefined`をまとめて判定する`== null` / `!= null`は許可します。型チェックは既存の`tsc --noEmit`で行います。

値の厳密検証にはPythonとSymPyを使います。開発用の依存を初回に準備してください（ビルド・配布アプリには不要です）。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-test.txt
```

`npm test`は`.venv`のPythonを優先し、なければ`python3`を使います。`FORMULA_CLOCK_PYTHON`で指定することもできます。

```sh
npm run typecheck
npm test
npm run build
npm run build:external
npm run test:og
```

`npm run typecheck`はTypeScriptの型チェックだけを実行します。`npm test`は最初に`npm run check`を実行し、整形・lint・型チェックの失敗を検出します。両ビルドにも型チェックを含めています。
`npm test`は整形・lint・型、単体テスト、単体／配信用ビルドを順に検証します。Git管理された生成HTMLには依存しないため、初回のチェックアウトでもそのまま実行できます。配布フォントの実際の読み込みはブラウザで確認します。各テストの範囲・個別実行・準備手順は[tests/README.md](tests/README.md)にまとめています。

```sh
npx playwright install chromium webkit
npm run test:browser -- clock --browser chromium
```

ブラウザテストの既定はMathJax 4.1.3のCDN経路です。`--local-mathjax`を使う互換テストとは区別してください。
HTTP配信の共有・多言語UIは、ローカルWorkerを起動して確認できます。

```sh
npm run test:browser -- share --browser chromium
npm run test:browser -- i18n --browser chromium
npm run test:browser -- transport --browser chromium
```

ログ・実行結果JSON・確認用スクリーンショットは、Git対象外の`test-results/`に保存します。
変更内容に応じた確認項目は[ACCEPTANCE.md](docs/ACCEPTANCE.md)を参照してください。

## ドキュメント

- [docs/FORMAT.md](docs/FORMAT.md)：式データ、表示設定、プロバイダーAPI、共有URLの仕様
- [SHARING.md](docs/SHARING.md)：Cloudflare・R2・OG画像の運用
- [ACCEPTANCE.md](docs/ACCEPTANCE.md)：変更時に確認する動作
- [AGENTS.md](AGENTS.md)：実装で守る要点と作業方針

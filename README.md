# Formula Clock

時刻の4桁（HHMM）から、秒（SS）を表す数式を表示する時計です。
数字は同じSVG要素のまま移動・拡縮し、式がない秒は淡いHH:MM:SSへ切り替わります。

## 起動

pnpm 12.4.1とPython 3.11以上を用意します。pnpm未導入の場合は[公式のインストール手順](https://pnpm.io/installation)を参照してください。`pnpm install`がNode.js 22.23.2とJavaScript・Pythonの依存を準備します。アプリ・Worker・ビルドツールのソースはTypeScriptです。

```sh
pnpm install
pnpm run dev
```

ViteがローカルのWorker・KV・R2と画面を起動します。`pnpm run build`で配信用アセットを`dist/site/`、Workerを`dist/worker/`へ生成し、`pnpm run preview:local`でその出力を確認できます。MathJax 4.1.3とフォントはアプリの遅延チャンクとしてバンドルされ、実行時にCDNへは接続しません。
Cloudflareへのプレビュー・公開・KV／R2設定は[共有機能の運用](docs/SHARING.md)を参照してください。

## 使い方

右上の設定からフォント、数字のスタイル、除算のスタイル、音量を変更できます。
フォントはSTIX Two / Termes / Fira / Euler、数字はLining / Oldstyleを独立して選びます。除算は分数・÷・/ の3種類です。初期値はSTIX Two + Oldstyle + 分数です。
表示設定と時報のオン／オフ・音量はブラウザに保存します。

秒の目盛りや時刻指定で一時停止し、← / →キーで1秒ずつ前後へ移動できます。分や日付の境界もまたげます。操作欄の「現在時刻へ」で通常の時計に戻ります。Spaceでも表示中の秒で一時停止し、もう一度押すと現在時刻へ戻ります。
共有ボタンを押すと表示中の秒で停止し、時刻・フォント・表示形式・式木をKVへ保存する短いURLを共有できます。
URLのIDが発行されたら共有を開き、KV保存の完了は待ちません。同じ表示の再共有では発行済みのURLを使い回します。
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
出典・取得先・SHA-256・確認済みバージョンは`licenses/`で管理し、本文は初回ビルド時に取得してGit管理外の`licenses/texts/`へキャッシュします。`pnpm run generate:licenses`でライセンス部分だけを生成できます。更新手順は[ライセンス表示の管理](licenses/README.md)を参照してください。

## ディレクトリ構成

```text
src/
  browser/       画面・CSS・組版・ブラウザ操作
  shared/        AST・表示設定・データ取得・共有URL・共通の型
  worker/        共有API・HTMLメタデータ・OG画像
  api.d.ts       公開APIの型
public/          配信用の静的設定・固定ロゴPNG（data/は生成物）
licenses/        ライセンスの取得先・ハッシュ・表示テンプレート
tools/           データ生成／取り込み・Vite用データ／ライセンス処理
data/            採用済み式データ・JSON Schema・形式サンプル
tests/
  unit/          Nodeによる単体・データ検証
  build/         配信用ビルドの検証
  og/            OG画像描画・workerdの統合テスト
  browser/       配布経路のMathJax 4を使うPlaywrightテスト
  fixtures/      固定したテスト入力
  helpers/       厳密計算・レポート出力などの補助コード
docs/            仕様・運用・確認項目・説明用の見本画像
dist/            ビルド出力（Git管理外）
test-results/    実行結果・スクリーンショット（Git管理外）
```

`src/browser/index.html`が画面の原本、`src/browser/main.ts`がViteのエントリーです。アプリ本体はデータ取得・表示設定・レンダラ・時計進行・共有・時報・全画面・ショートカットの役割別モジュールに分かれ、`app.ts`が合成ルートとして配線し、最後に公開API`window.FormulaClock`を組み立てます。`bootstrap.ts`はテスト・コンソール向けに共有モジュールを`window`へ載せます。データ取得の既定値は`provider.ts`が登録します。`tools/vite-clock.ts`はライセンス表示と式データだけを用意し、JavaScript・HTML・WASMの処理はViteと既存プラグインに任せます。原本を編集して`pnpm run build`で更新してください。

`dist/`と`test-results/`は削除・再生成できるためGitへ入れません。`data/expressions.json`は採用済みの入力データ、`docs/images/`は説明用の見本、`tests/fixtures/og-snapshots/`は画像差分の基準入力なのでGit管理します。`public/data/`も生成物です。テストの実際の画像や差分は`test-results/`へ出力します。

`pnpm run generate`は全日の式を再探索し、現在の採用データを上書きします。通常の表示変更やビルドには不要です。外部データは`pnpm run import:data DIRECTORY`で取り込みます。出典と手順は[data/README.md](data/README.md)を参照してください。

## 検証

整形は[Oxfmt](https://oxc.rs/docs/guide/usage/formatter)、lintは[Oxlint](https://oxc.rs/docs/guide/usage/linter)を使います。
TypeScript・JavaScriptの原本とテスト、CSS、JSON設定、Markdownを整形します。2スペース・シングルクォート・100文字幅を基準にし、importの自動並べ替えは行いません。
生成物・採用済み式データ・形式サンプル・ロックファイルは整形対象外です。HTMLやTypeScriptの整形後は`pnpm run build`で出力を更新します。

```sh
pnpm run format       # 原本を一括整形
pnpm run lint:fix     # 安全なlint自動修正（残った指摘は手で修正）
pnpm run check        # 整形確認・lint・TypeScript型チェック
```

`pnpm run format:check`と`pnpm run lint`も単独で実行できます。Oxlintはcorrectnessルールと、厳密な比較・`const`の使用・`var`の禁止をチェックし、警告も失敗として扱います。`null`と`undefined`をまとめて判定する`== null` / `!= null`は許可します。型チェックは既存の`tsc --noEmit`で行います。

JavaScript依存は`package.json`と`pnpm-lock.yaml`、テスト用のSymPyは`pyproject.toml`と`pylock.toml`で管理します。`packageManager`でpnpm、`devEngines.runtime`でNode.jsの版も固定しています。同じOS・Python環境では`pnpm install --frozen-lockfile`で両方を再現できます。

Python連携はpnpmの実験機能で、この版のPythonロックは生成したOS・Python環境に対応します。環境が異なる場合は通常の`pnpm install`でPythonロックを更新します。Python本体は別途用意し、仮想環境と依存はpnpmに管理させます。`.venv`は`.pnpm/python-envs/`を指すリンクとして自動生成され、どちらもGit管理外です。以前の手作業で作った`.venv`がある場合は別名へ移してからインストールしてください。詳細は[テストの準備](tests/README.md)に記載しています。

`pnpm test`はこの`.venv`を使います。別の環境で検証する場合のみ`FORMULA_CLOCK_PYTHON`で明示的に指定できます。

```sh
pnpm run check
pnpm test
pnpm run build
pnpm run test:og
```

単体・ビルド・OG検証はVitest、画面検証はPlaywright Testを使います。VitestのTypeScript変換はViteが担当し、`pnpm run test:watch`で単体テストを変更時に再実行できます。ビルドは[Vite](https://vite.dev/)、Worker・WASM・配布設定は[Cloudflare公式プラグイン](https://developers.cloudflare.com/workers/vite-plugin/)が担当します。

`pnpm run typecheck`はTypeScriptの型チェックだけを実行します。整形・lint・型の確認は`pnpm run check`、テストの実行は`pnpm test`と役割を分けているため、通常は両方を実行します。ビルドには型チェックを含めています。
`pnpm test`は単体テストと配信用ビルドを順に検証します。Git管理された生成HTMLには依存しないため、初回のチェックアウトでもそのまま実行できます。配布フォントの実際の読み込みはブラウザで確認します。各テストの範囲・個別実行・準備手順は[tests/README.md](tests/README.md)にまとめています。

```sh
pnpm exec playwright install chromium firefox webkit
pnpm run test:browser clock.test.ts --project chromium
```

ブラウザテストは配布物そのままのMathJax 4.1.3（バンドル済みチャンク）を使います。
HTTP配信の共有・多言語UIは、Playwright TestがローカルWorkerを自動で起動して確認します。

```sh
pnpm run test:browser --grep '^share$' --project chromium
pnpm run test:browser i18n.test.ts --project chromium
pnpm run test:browser transport.test.ts --project chromium
```

ログ・実行結果JSON・確認用スクリーンショットは、Git対象外の`test-results/`に保存します。
変更内容に応じた確認項目は[ACCEPTANCE.md](docs/ACCEPTANCE.md)を参照してください。

## ドキュメント

- [docs/FORMAT.md](docs/FORMAT.md)：式データ、表示設定、プロバイダーAPI、共有URLの仕様
- [SHARING.md](docs/SHARING.md)：Cloudflare・R2・OG画像の運用
- [ACCEPTANCE.md](docs/ACCEPTANCE.md)：変更時に確認する動作
- [AGENTS.md](AGENTS.md)：実装で守る要点と作業方針

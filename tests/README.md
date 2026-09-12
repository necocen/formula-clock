# テストの実行と配置

pnpm 12.4.1とPython 3.11以上を用意します。Node.js 22.23.2はpnpmが準備します。実行コードはTypeScriptのES Modulesに揃え、単体・ビルド・OG検証はVitest、ブラウザ検証はPlaywright Testで実行します。PythonはSymPyの厳密計算にだけ使います。

```sh
pnpm install
pnpm exec playwright install chromium firefox webkit
```

`pnpm-workspace.yaml`でPython連携を有効にしています。SymPyは`pyproject.toml`の`dev`グループで指定し、`pylock.toml`で間接依存・取得ファイルも固定します。JavaScriptの`pnpm-lock.yaml`とともにGit管理します。

pnpm 12.4.1のPythonロックにはOS・Pythonの環境情報も含まれ、別の環境では`--frozen-lockfile`が失敗します。初回や環境変更時は通常の`pnpm install`でロックを更新してください。対応するロックがある環境では`pnpm install --frozen-lockfile`、取得済みのキャッシュから再現するときは`pnpm install --offline --frozen-lockfile`を使えます。CIで環境が変わった場合も、対象環境でロックを更新してから固定インストールを使います。

pnpmは`.pnpm/python-envs/`に環境を作り、`.venv`をそこへ向けます。手動のactivateやpip installは不要です。`pnpm exec python`や`pnpm run`からも同じ環境を使えます。Python本体は自動インストールされないため、`python3`（Windowsでは`python`）を先に用意してください。使用するインタプリタを変える場合は`pnpm-workspace.yaml`の`python.executable`で指定できます。

以前の手作業で作った`.venv`はpnpmが上書きしません。その場合は既存環境を別名へ退避してから`pnpm install`を実行してください。pnpmが管理する`.venv`・`.pnpm/`・`node_modules/`は削除して再作成できます。Python連携は実験機能なので、pnpmの更新時には環境の再作成とテストを確認します。

## 基本の確認

```sh
pnpm run check        # 整形・lint・型チェック
pnpm test             # 単体テスト → ビルドテスト
pnpm run test:unit    # AST・全日データ・取得・共有・キャッシュなど
pnpm run test:watch   # 単体テストを変更時に再実行
pnpm run test:build   # 配信用アセットを実際にビルドして検証
pnpm run test:og      # 配信用ビルド → 画像描画とworkerdの統合テスト
```

`vitest.config.ts`で`unit`・`build`・`og`のプロジェクトを定義しています。`pnpm test`は`unit`・`build`を実行します。整形・lint・型チェックは`pnpm run check`で別に実行します。VitestはViteによってTypeScriptを変換しますが、型チェックは`tsc --noEmit`で別に行います。

`unit/`は生成物に依存しません。`build/`と`og/`は実行時に必要なビルドを作ります。採用済みの`data/expressions.json`を読み取るだけで、式の再探索は行いません。

`fixtures/`は固定した入力、`helpers/`はSymPyによる厳密計算やレポート出力の補助です。補助ファイルに`.test.*`を付けず、実行対象と区別してください。すべてのテストは`*.test.ts`で揃え、型チェックの対象に含めます。

## ブラウザ

`playwright.config.ts`のブラウザ別プロジェクトと、`tests/helpers/browser.ts`のfixtureを使います。Playwright Testがブラウザの起動・後片付け、テスト選択、タイムアウト、レポート、失敗時のトレースを管理します。

```sh
pnpm run test:browser --list
pnpm run test:browser clock.test.ts --project chromium
pnpm run test:browser i18n.test.ts --project webkit
pnpm run test:browser --project chromium --project webkit
```

引数なしでは設定済みの全ブラウザとOG画像差分を実行します。Chromium・WebKitは全13スイート、Firefoxは対応する9スイートです。テストファイル名か`--grep`で絞り込み、`--project`でブラウザを選択します。`share`など名前が重なる場合は`--grep '^share$'`でテスト名を完全一致させてください。アニメーションの計測に競合が出ないよう、実行workerは1に固定しています。

実行時に配信版をViteでビルドし、`vite preview`のHTTP Workerを自動で起動・終了します。`--list` / `--help`ではビルドやサーバー起動は行いません。既定のHTTP URLは`http://127.0.0.1:8787/`です。開発中に同じポートでWorkerが動いていれば再利用し、CIでは既存サーバーとの競合をエラーにします。

全スイートがHTTPを使います。プレビューなど別の配信先を確認するときは`FORMULA_CLOCK_TEST_URL`を指定します。この場合はローカルWorkerを起動しません。

```sh
FORMULA_CLOCK_TEST_URL=http://127.0.0.1:8787/ pnpm run test:browser clock.test.ts --project chromium
pnpm run test:browser --grep '^share$' --project chromium
pnpm run test:browser transport.test.ts --project chromium
```

ブラウザの操作・通信モック・検証はNodeで実行します。SymPyの補助処理だけはpnpmが管理する`.venv`を使い、別環境の検証時には`FORMULA_CLOCK_PYTHON`でも指定できます。

| スイート                                              | 主な確認                                            |
| ----------------------------------------------------- | --------------------------------------------------- |
| `clock`                                               | 4書体・数字スタイル・除算・桁の同一性・配置・画面幅 |
| `i18n`                                                | 日本語・英語・言語フォールバック・ライセンス全文    |
| `transport`                                           | 左右キー・一時停止・現在時刻への復帰                |
| `fullscreen`                                          | 全画面API・利用不可・拒否・接頭辞付きAPI            |
| `audio` / `audio-settings`                            | 時報の波形・音量・保存復元・自動再生待ち            |
| `motion-settings`                                     | 記号アニメーション設定の依存関係・保存復元          |
| `symbol-motion` / `structure-motion` / `symbol-morph` | 記号・構造・変形の各アニメーション                  |
| `share` / `kv-share`                                  | 共有URL・保存済みAST・競合                          |
| `og-parity`                                           | OG画像とブラウザの字形・軸・配置の一致              |

`og-snapshots`プロジェクトはブラウザを起動せず、workerdから取得したPNGをPlaywright標準の`toMatchSnapshot`で比較します。4書体×2種類の数字×分数・指数・通常時計、÷・スラッシュ、代替ロゴの27件です。許容する差分は0ピクセル。基準PNGはVite移行前のレンダラー（`2ef649c`）から固定しました。

```sh
pnpm run test:browser --project og-snapshots
pnpm exec playwright show-report test-results/playwright-report
```

意図した見た目の変更時は、先にレポートの実際の画像・差分を目視し、`pnpm run test:browser --project og-snapshots --update-snapshots`で基準を更新します。更新後は通常コマンドを再実行し、基準PNGも変更と一緒にコミットしてください。固定ロゴを変更した場合は`src/worker/assets/default.svg`に対応する1200×630の`public/og-default.png`も更新します。`test:og`がSVGからのPNGと配布アセットの一致を確認します。

`og-parity`は現在のソースから240ケースのOG画像・測定値を自動生成します。以前の実行結果に依存しません。別途取得した測定値と比較するときだけ`FORMULA_CLOCK_RENDER_RESULTS`へJSONのパスを指定してください。

追加の設定は次の環境変数、または`playwright.config.ts`の`use.clockOptions`で変更できます。出力先は標準の`--output DIRECTORY`で変更できます。

| 環境変数                           | 用途                              |
| ---------------------------------- | --------------------------------- |
| `FORMULA_CLOCK_TEST_URL`           | 配信先URLの上書き                 |
| `FORMULA_CLOCK_SCREENSHOTS=1`      | `clock`の各ケースの見本画像も保存 |
| `FORMULA_CLOCK_SYMBOL_MOTION=0`    | `clock`で基本記号の移動を無効化   |
| `FORMULA_CLOCK_STRUCTURE_MOTION=0` | `clock`で構造記号の移動を無効化   |
| `FORMULA_CLOCK_SYMBOL_MORPH=0`     | `clock`で四則記号の変形を無効化   |
| `FORMULA_CLOCK_RENDER_RESULTS`     | `og-parity`で使う外部の測定値JSON |

`clock`で移動を完全に無効化する場合は、3つのmotion設定をすべて`0`にします。構造の移動・四則記号の変形には基本記号の移動が必要なためです。

ブラウザ検証は配布物のMathJax 4だけを使います。MathJaxとフォントはアプリの遅延チャンクとして配信されます。

## 実行結果

出力はすべてGit管理外の`test-results/`へ保存します。

- `unit/`: 単体テストの詳細な計算結果
- `og/`: 共有画像・測定値
- `browser/`: Playwrightがテスト・ブラウザごとに分けた結果JSON・画像・失敗時のトレース
- `playwright-report/`: HTMLレポート（`pnpm exec playwright show-report test-results/playwright-report`で表示）
- `generate/`: オフラインデータ探索の集計

独自のJSONは字形・配置などの詳細な計測値を残すためのものです。テストの成否と失敗箇所はPlaywright Testの標準レポートで確認できます。JSONはHTMLレポートにも添付します。

`tests/`には実行コードと固定入力だけを置きます。画像差分の基準PNGは`tests/fixtures/og-snapshots/`、説明用の見本は`docs/images/`へ置きます。実際の画像・差分・トレースは`test-results/`へ出力します。

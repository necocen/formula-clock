# テストの実行と配置

pnpm 12.4.1とPython 3.11以上を用意します。Node.js 22.23.2はpnpmが準備します。実行コードはTypeScriptのES Modulesに揃え、`node:test`とNode版Playwrightで検証します。PythonはSymPyの厳密計算とfontToolsの字形抽出にだけ使います。

```sh
pnpm install
pnpm exec playwright install chromium webkit
```

`pnpm-workspace.yaml`でPython連携を有効にしています。SymPyとfontToolsは`pyproject.toml`の`dev`グループで指定し、`pylock.toml`で間接依存・取得ファイルも固定します。JavaScriptの`pnpm-lock.yaml`とともにGit管理します。

pnpm 12.4.1のPythonロックにはOS・Pythonの環境情報も含まれ、別の環境では`--frozen-lockfile`が失敗します。初回や環境変更時は通常の`pnpm install`でロックを更新してください。対応するロックがある環境では`pnpm install --frozen-lockfile`、取得済みのキャッシュから再現するときは`pnpm install --offline --frozen-lockfile`を使えます。CIで環境が変わった場合も、対象環境でロックを更新してから固定インストールを使います。

pnpmは`.pnpm/python-envs/`に環境を作り、`.venv`をそこへ向けます。手動のactivateやpip installは不要です。`pnpm exec python`や`pnpm run`からも同じ環境を使えます。Python本体は自動インストールされないため、`python3`（Windowsでは`python`）を先に用意してください。使用するインタプリタを変える場合は`pnpm-workspace.yaml`の`python.executable`で指定できます。

以前の手作業で作った`.venv`はpnpmが上書きしません。その場合は既存環境を別名へ退避してから`pnpm install`を実行してください。pnpmが管理する`.venv`・`.pnpm/`・`node_modules/`は削除して再作成できます。Python連携は実験機能なので、pnpmの更新時には環境の再作成とテストを確認します。

## 基本の確認

```sh
pnpm test             # 整形・lint・型 → 単体テスト → ビルドテスト
pnpm run test:unit    # AST・全日データ・取得・共有・キャッシュなど
pnpm run test:build   # 単体HTMLと配信用アセットを実際にビルドして検証
pnpm run test:og      # 配信用ビルド → 画像描画とworkerdの統合テスト
```

`unit/`は生成物に依存しません。`build/`と`og/`は実行時に必要なビルドを作ります。採用済みの`data/expressions.json`を読み取るだけで、式の再探索は行いません。

`fixtures/`は固定した入力、`helpers/`はSymPyによる厳密計算やレポート出力の補助です。補助ファイルに`.test.*`を付けず、実行対象と区別してください。すべてのテストは`*.test.ts`で揃え、型チェックの対象に含めます。

## ブラウザ

```sh
pnpm run test:browser --list
pnpm run test:browser clock --browser chromium
```

ブラウザの操作・通信モック・検証はNodeで実行します。通常の実行前には単体HTMLをビルドし、`--list` / `--help`ではビルドしません。SymPyとfontToolsの補助処理だけはpnpmが管理する`.venv`を使い、別環境の検証時には`FORMULA_CLOCK_PYTHON`でも指定できます。

`clock`の既定は`dist/standalone/index.html`を直接開くテストです。他のスイートはローカルWorkerを使うため、別のターミナルで起動してください。

```sh
pnpm run dev
# 別のターミナルで:
pnpm run test:browser i18n --browser webkit
pnpm run test:browser transport --browser chromium
```

HTTPの既定URLは`http://127.0.0.1:8787/`です。`--url`でプレビューなどへ変更できます。`--output-dir`で出力先も指定できます。

| スイート                                              | 主な確認                                            |
| ----------------------------------------------------- | --------------------------------------------------- |
| `clock`                                               | 4書体・数字スタイル・除算・桁の同一性・配置・画面幅 |
| `i18n`                                                | 日本語・英語・言語フォールバック・ライセンス全文    |
| `transport`                                           | 左右キー・一時停止・現在時刻への復帰                |
| `fullscreen`                                          | 全画面API・利用不可・拒否・接頭辞付きAPI            |
| `audio` / `audio-settings`                            | 時報の波形・音量・保存復元・自動再生待ち            |
| `motion-settings`                                     | 記号アニメーション設定の依存関係・保存復元          |
| `symbol-motion` / `structure-motion` / `symbol-morph` | 記号・構造・変形の各アニメーション                  |
| `share` / `kv-share` / `speculative-share`            | 共有URL・保存済みAST・先行発行・競合                |
| `og-parity`                                           | OG画像とブラウザの字形・軸・配置の一致              |

`og-parity`は`pnpm run test:og`が作る`test-results/og/render-results.json`を先に用意してください。対応ブラウザや固有の引数は`pnpm run test:browser SUITE --help`で確認できます。

`browser/`は`node:test`からPlaywrightを操作するテストです。`all`は14スイートを順番に実行します（ローカルWorkerとOG描画結果を先に用意してください）。例えば`pnpm run test:browser all --browser webkit`で一括実行できます。既定は配布用MathJax 4のCDNを使います。`clock --local-mathjax DIRECTORY`を使った場合は互換性確認として扱い、CDN版の成功に数えません。

## ローカルフォントの互換性確認

`compat/`には、手元のMathJax 3とSTIX Twoフォントを使う確認を隔離しています。通常のテストには含めません。必要なファイルは実行者が用意してください。

```sh
pnpm run test:browser compat/stix2 --local-mathjax DIRECTORY --stix-fonts DIRECTORY
```

## 実行結果

出力はすべてGit管理外の`test-results/`へ保存します。

- `unit/`: Nodeテストの集計
- `og/`: 共有画像・測定値
- `browser/SUITE/BROWSER/`: ブラウザの結果JSON・スクリーンショット
- `compat/stix2/chromium/`: ローカルフォントの互換性確認
- `generate/`: オフラインデータ探索の集計

`tests/`には実行コードと固定入力だけを置きます。比較の基準として残す画像は、テストの生出力と区別して`docs/images/`へ置き、用途を文書に記載してください。

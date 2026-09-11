# テストの実行と配置

Node.js 22系の22.12.0以上と、Pythonの開発用依存を使います。

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-test.txt
.venv/bin/python -m playwright install chromium webkit
```

## 基本の確認

```sh
npm test             # 整形・lint・型 → 単体テスト → ビルドテスト
npm run test:unit    # AST・全日データ・取得・共有・キャッシュなど
npm run test:build   # 単体HTMLと配信用アセットを実際にビルドして検証
npm run test:og      # 配信用ビルド → 画像描画とworkerdの統合テスト
```

`unit/`は生成物に依存しません。`build/`と`og/`は実行時に必要なビルドを作ります。採用済みの`data/expressions.json`を読み取るだけで、式の再探索は行いません。

`fixtures/`は固定した入力、`helpers/`はSymPyによる厳密計算やレポート出力の補助です。補助ファイルに`.test.*`を付けず、実行対象と区別してください。Nodeのテストは`*.test.cjs` / `*.test.mjs`で揃え、`node:test`で実行します。

## ブラウザ

```sh
npm run test:browser -- --list
npm run test:browser -- clock --browser chromium
```

実行ツールは`.venv`のPythonを優先します。`FORMULA_CLOCK_PYTHON`でも指定できます。通常の実行前には単体HTMLをビルドし、`--list` / `--help`ではビルドしません。

`clock`の既定は`dist/standalone/index.html`を直接開くテストです。他のスイートはローカルWorkerを使うため、別のターミナルで起動してください。

```sh
npm run dev
# 別のターミナルで:
npm run test:browser -- i18n --browser webkit
npm run test:browser -- transport --browser chromium
```

HTTPの既定URLは`http://127.0.0.1:8787/`です。`--url`でプレビューなどへ変更できます。`--output-dir`で出力先も指定できます。

| スイート                                              | 主な確認                                            |
| ----------------------------------------------------- | --------------------------------------------------- |
| `clock`                                               | 4書体・数字スタイル・除算・桁の同一性・配置・画面幅 |
| `i18n`                                                | 日本語・英語・言語フォールバック・ライセンス全文    |
| `transport`                                           | 左右キー・一時停止・現在時刻への復帰                |
| `fullscreen`                                          | 全画面API・利用不可・拒否・接頭辞付きAPI            |
| `audio` / `audio_settings`                            | 時報の波形・音量・保存復元・自動再生待ち            |
| `motion_settings`                                     | 記号アニメーション設定の依存関係・保存復元          |
| `symbol_motion` / `structure_motion` / `symbol_morph` | 記号・構造・変形の各アニメーション                  |
| `share` / `kv_share` / `speculative_share`            | 共有URL・保存済みAST・先行発行・競合                |
| `og_parity`                                           | OG画像とブラウザの字形・軸・配置の一致              |

`og_parity`は`npm run test:og`が作る`test-results/og/render-results.json`を先に用意してください。対応ブラウザや固有の引数は`npm run test:browser -- SUITE --help`で確認できます。

`browser/`はPlaywrightの独立したスクリプトです。pytestの収集対象ではありません。既定は配布用MathJax 4のCDNを使います。`clock --local-mathjax DIRECTORY`を使った場合は互換性確認として扱い、CDN版の成功に数えません。

## ローカルフォントの互換性確認

`compat/`には、手元のMathJax 3とSTIX Twoフォントを使う確認を隔離しています。通常のテストには含めません。必要なファイルは実行者が用意してください。

```sh
npm run build
.venv/bin/python tests/compat/stix2.py --local-mathjax DIRECTORY --stix-fonts DIRECTORY
```

## 実行結果

出力はすべてGit管理外の`test-results/`へ保存します。

- `unit/`: Nodeテストの集計
- `og/`: 共有画像・測定値
- `browser/SUITE/BROWSER/`: ブラウザの結果JSON・スクリーンショット
- `compat/stix2/`: ローカルフォントの互換性確認
- `generate/`: オフラインデータ探索の集計

`tests/`には実行コードと固定入力だけを置きます。比較の基準として残す画像は、テストの生出力と区別して`docs/images/`へ置き、用途を文書に記載してください。

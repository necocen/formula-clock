# 検証の記録と再現方法

引き継ぎ準備：2026-09-08。対象はr5-stix2 / package 5.0.0。
以前の実行記録と、この引き継ぎで再実行した確認を区別する。

## 今回実行した確認

環境：Node.js 22.16.0、npm 10.9.2、Python 3.13.5。
実行は前回ソースZIPを展開した作業用コピーに対して行った。

| 確認 | 結果 | 記録 |
|---|---|---|
| `npm test` | 成功。1,440分、71,456式、14,944件のnull、305,824件のTeXシリアライズ | `verification/npm-test.log` / `verification/expression-results.json` |
| プロバイダー単体テスト（`npm test` に含む） | 成功。欠落、明示的null、HTTP失敗、中止、全日取得の共有など | `verification/provider-results.json` |
| `npm run build` | 成功。420,877 bytes。前回渡したHTMLとSHA-256一致 | `verification/build.log` |
| `npm run build:external` | 成功。HTML 72,204 bytes、1,440件の分単位JSON | `verification/build.log` |
| 外部分単位JSONと元の全日データの照合 | 全1,440件が一致 | `verification/handoff-audit.json` |
| HTML内のgzipデータと元データの照合 | 一致 | `verification/handoff-audit.json` |
| 元ソースZIPと引き継ぎソースの照合 | READMEへの案内追加を除き、既存ファイルはバイト単位で同一 | `verification/handoff-audit.json` |

`npm test` の `profiles: 2` は数式生成の2種類の設定方針を指す。表示側の3書体を実際に読み込んで描画した回数ではない。
計算結果は同梱ソルバの評価関数で検証する。生成時の探索制限のため、nullの秒を「式が存在しない」と判定したものではない。

HTMLのSHA-256：

```text
12fac051c850668c17c6b9948dd4d86c2f657bc9e9b548464826c05fc90f4eba
```

今回ブラウザテストは再実行していない。外部データ版も、生成結果の照合までであり、HTTP経由のブラウザ動作確認は行っていない。

## 以前のブラウザ検証の記録

`../tests/stix2-compatibility-results.json` に以下の実行記録がある。

- MathJax 3.2.1へSTIX Twoの実字形と寸法を設定するローカル互換テスト。
- 記録されたフォント版はVersion 2.12 b168。
- 60配置ケース、STIX Twoの6のパス一致、3書体設定、両除算表記、数字要素の同一性、等号の固定、通常時刻表示、320/390/768px幅。
- 記録中のpageErrorsは空。

この記録と `../tests/screenshots/` は今回再実行したものではない。
MathJax 4.1.3の配布経路が成功したという証拠には使用しない。
Euler設定をローカルのTeX字形で代用した検査も含むため、Eulerの実字形確認とは区別する。

以前のNodeテストの出力は `../tests/expression-results.json` と `../tests/provider-results.json` にそのまま残した。
今回の出力はこの文書と同じディレクトリの `verification/` に分けてある。

## 配布版そのものを確認する

プロジェクトルートから実行する。

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-test.txt
python -m playwright install chromium
python tests/browser.test.py --screenshots
```

既定のスクリプトはCDNを使用する。成功した場合の出力は `tests/browser-results.json`。
`--local-mathjax` を指定しないこと。
このスクリプトはChromium用なので、Firefox / Safariの目視確認は別に行う。

確認する経路はMathJax 4.1.3＋`mathjax-stix2`、Euler、Computer Modernの各プロファイル。
特に、STIX Twoのオールドスタイル数字が実際に使われているかを画面・字形・通信で確かめる。
ブラウザが使う書体と、手元の見本を作ったローカルフォントを同一視しない。

以前の環境ではCDN接続が制限されていた。この制約はその環境の記録であり、ユーザー環境での接続失敗を示すものではない。
新しい環境で接続できるかを確認し、できなければ未確認のまま報告する。

## ローカル互換テストを再実行する

このテストには、別途用意したMathJax 3.2.1の `es5` ディレクトリと、以下のSTIX Twoフォントを置いたディレクトリが必要。

```text
STIXTwoText-Regular.otf
STIXTwoMath-Regular.otf
```

```sh
python tests/stix2.local.test.py \
  --local-mathjax /path/to/mathjax-full/es5 \
  --stix-fonts /path/to/stix2-otf
```

`fonttools` は `requirements-test.txt` に含む。このスクリプトはPATH上の `chromium` を明示的に使用する実装なので、
環境によって実行ファイルの指定方法を調整する必要がある。配布版ブラウザテスト側にはPlaywright管理のChromiumを使う経路もある。

テスト時だけ字形とメトリクスを読み取る `tests/local_stix_fixture.py` があり、時計本体では使わない。
ローカルテストは配置の検証に利用し、結果にはMathJax 3の互換テストと明記する。

## 引き継ぎZIPの整合性

`ORIGIN.json` に前回のソースZIPと配布HTMLの識別情報を保存した。
`SHA256SUMS.txt` は同梱ファイルのSHA-256一覧（一覧ファイル自身を除く）。展開直後の状態に対して使用する。

```sh
# Linux
sha256sum -c SHA256SUMS.txt

# macOS
shasum -a 256 -c SHA256SUMS.txt
```

ビルド、テスト、コード編集を行うと対象ファイルの値が変わる場合がある。更新後の成果物は別の版として記録する。

# ライセンス表示の管理

ライセンス画面は`tools/licenses.ts`で生成し、通常のビルドが`src/browser/app.html`の`<!-- clock-licenses -->`へ挿入します。手作業で配信用HTMLへ貼り付ける必要はありません。

```sh
npm run generate:licenses   # ライセンス部分だけを dist/licenses.html へ生成
npm run build              # 単体HTMLへ組み込み
npm run build:external     # 配信用HTMLへ組み込み
```

生成はローカルのファイルだけを読み、ネットワークへアクセスしません。生成物はGitへ入れません。

- `notice.html`: 日本語の説明・見出し・フォント内部の著作権表示。`{{version:パッケージ名}}`、`{{source:本文ID}}`、`{{text:本文ID}}`、`{{reviewed-on}}`を生成時に置換します。
- `manifest.json`: 照合日、確認済みのパッケージ版とライセンス識別子、全文の読み取り元・上流の参照先。
- `texts/`: npm配布物に含まれない原書体とresvg-jsのライセンス全文。従来の画面に掲載していた原文を、HTMLの文字参照を復号して保存しています。TermesとLatin ModernのGUST本文は共通です。

Apache 2.0の全文はインストール済みの`@mathjax/src/LICENSE`から読み取ります。フォントパッケージの`package.json`にあるApache 2.0という表記だけでは原書体のライセンス全文を得られないため、原書体の本文は別に保持します。`source`は照合先を示す参照URLで、生成時のダウンロード先ではありません。

本文はHTMLエスケープして`pre`へ挿入し、改行・空白を保持します。ライセンス説明は日本語のまま、ダイアログの見出しと閉じる操作だけを共通UIの翻訳対象にします。

## 依存パッケージを更新するとき

1. `package.json`とロックファイルを更新し、依存をインストールします。MathJaxの更新では`src/browser/typesetter.ts`のCDN版も揃えます。
2. 更新版の配布物と上流のライセンスを確認し、必要なら`texts/`と`notice.html`の著作権・書体内部の版表示・説明を更新します。フォント内部の表示は配布WOFF2のnameテーブル（copyright・version・license等）から確認します。
3. `manifest.json`の確認済みバージョン・ライセンス識別子・参照URL・照合日を更新します。確認済みという記録なので、バージョン番号だけを機械的に書き換えないでください。
4. `npm run generate:licenses`と`npm test`を実行し、ブラウザのLICENSE画面を確認します。CDNや書体も更新した場合は、`tests/README.md`の該当ブラウザテストも実行します。

生成時には、プロジェクトの指定版・インストール済みの版とライセンス識別子・確認済みの記録を照合します。MathJaxのCDN版の不一致、新しい`@mathjax/`・`@resvg/`直接依存の記録漏れ、本文ファイルの欠落・空文字、テンプレートの未定義参照・本文の掲載漏れもエラーにします。開発ツールを含む全npm依存のライセンス走査は行いません。

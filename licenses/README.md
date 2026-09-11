# ライセンス表示の管理

ライセンス画面は`tools/licenses.ts`で生成し、通常のビルドが`src/browser/app.html`の`<!-- clock-licenses -->`へ挿入します。手作業で配信用HTMLへ貼り付ける必要はありません。

```sh
npm run generate:licenses   # ライセンス部分だけを dist/licenses.html へ生成
npm run build              # 単体HTMLへ組み込み
npm run build:external     # 配信用HTMLへ組み込み
```

本文キャッシュがない初回の生成では、上流から取得してSHA-256を検証します。正常なキャッシュがあればネットワークへアクセスしません。`licenses/texts/`と`dist/`はGit管理外です。どちらも削除して再生成できます。

- `notice.html`: 日本語の説明・見出し・フォント内部の著作権表示。`{{version:パッケージ名}}`、`{{source:本文ID}}`、`{{text:本文ID}}`、`{{reviewed-on}}`を生成時に置換します。
- `manifest.json`: 照合日、確認済みのパッケージ版とライセンス識別子、本文の参照先・ダウンロードURL・SHA-256。GitHubの取得先はコミットを固定しています。
- `texts/`: npm配布物に含まれない原書体とresvg-jsのライセンス全文のキャッシュ。生成時に自動取得するので編集・コミットしません。TermesとLatin ModernのGUST本文は共通です。

Apache 2.0の全文はインストール済みの`@mathjax/src/LICENSE`から読み取ります。原書体の全文を含まないnpmパッケージについては、`download`のURLから取得します。`source`は画面にも使う参照先です。キャッシュも毎回SHA-256を照合し、破損していたら再取得します。取得失敗やハッシュ不一致はエラーにして、不完全なライセンス表示を出力しません。

キャッシュは取得した原文をそのまま保持します。画面にはHTMLエスケープして`pre`へ挿入し、HTMLの改行規則に合わせてCRLFをLFへ揃えます。ライセンス説明は日本語のまま、ダイアログの見出しと閉じる操作だけを共通UIの翻訳対象にします。

## 依存パッケージを更新するとき

1. `package.json`とロックファイルを更新し、依存をインストールします。MathJaxの更新では`src/browser/typesetter.ts`のCDN版も揃えます。
2. 更新版の配布物と上流のライセンスを確認し、必要なら`notice.html`の著作権・書体内部の版表示・説明を更新します。フォント内部の表示は配布WOFF2のnameテーブル（copyright・version・license等）から確認します。
3. `manifest.json`の確認済みバージョン・ライセンス識別子・参照URL・照合日を更新します。本文が変わったら、固定した取得先と実際の原文のSHA-256（`shasum -a 256 FILE`）も更新します。確認済みという記録なので、バージョン番号やハッシュだけを機械的に書き換えないでください。
4. `npm run generate:licenses`と`npm test`を実行し、ブラウザのLICENSE画面を確認します。CDNや書体も更新した場合は、`tests/README.md`の該当ブラウザテストも実行します。

生成時には、プロジェクトの指定版・インストール済みの版とライセンス識別子・確認済みの記録を照合します。MathJaxのCDN版の不一致、新しい`@mathjax/`・`@resvg/`直接依存の記録漏れ、取得失敗・ハッシュ不一致・空の本文、テンプレートの未定義参照・本文の掲載漏れもエラーにします。開発ツールを含む全npm依存のライセンス走査は行いません。

# このプロジェクトで作業するエージェントへ

使い方と開発手順は `README.md`、データとAPIの仕様は `docs/FORMAT.md`。このファイルは実装で守る要点。
後続のユーザー指示による仕様変更は、その指示を優先する。

## 編集とビルド

- 表示アプリの原本は`src/browser/`（マークアップ`index.html`・CSS`styles.css`・合成ルート`app.ts`・役割別モジュール`dom.ts` / `audio.ts` / `data-source.ts` / `settings.ts` / `renderer.ts` / `clock.ts` / `sharing.ts` / `fullscreen.ts` / `shortcuts.ts` / `typesetter.ts`）と`src/shared/`（`i18n.ts` / `display.ts` / `share.ts` / `expression.ts` / `data.ts` / `symbols.ts` / `typography.ts` / `mathjax/` / `palette.css`）。ビルド時に`<!-- clock-licenses -->`へライセンス表示を挿入する。共有画像と配信処理は `src/worker/`。
- ライセンスの取得先・SHA-256・出典・確認済みの依存版は`licenses/`で管理し、`tools/licenses.ts`で生成する。本文は取得してGit管理外の`licenses/texts/`へキャッシュする。通常ビルドでも自動生成し、`pnpm run generate:licenses`で単独確認できる。更新時は`licenses/README.md`に従い、配布物と照合してから確認済み版とハッシュを更新する。
- アプリ・Worker・ビルドツール・テストはTypeScriptのES Modules。単体・ビルド・OG検証はVitest、ブラウザ検証はPlaywright Testで実行し、PythonはSymPyの厳密計算だけに使う。共通の型は `src/shared/types.ts`、ブラウザ固有の型は `src/browser/types.ts` / `src/browser/globals.d.ts`。`strict`を保ち、信頼境界を型とAPIの契約に明記する。管理下の式データは生成・取り込み・ビルド時に検証し、実行時のAST検証・複製・凍結は行わない。公開の共有作成APIが受け取る外部JSONはサーバーで検証する。
- モジュール間の依存はESモジュールのimportで宣言する。`bootstrap.ts`の`window`公開はブラウザテスト・コンソール用の公開面で、アプリ内部の参照には使わない。ブラウザの各モジュールは`createX(deps)`ファクトリでモジュールトップレベルの副作用を持たず、合成順序・リスナー登録順（ショートカット→時報再開のkeydown）は`app.ts`が管理する。遅延バインドのクロージャはイベント・Promise継続・タイマーからのみ発火させる。世代カウンタ（`dataRevision` / `requestSerial` / `shareSerial` / `TimeSignal.revision`）はガードと継続を同一モジュール内に保つ。ビルドはVite、Worker・WASM・配布設定はCloudflare公式プラグインを使う。`tools/vite-clock.ts`には式データとライセンス固有の処理だけを置き、独自バンドラーやWASMローダーを追加しない。
- `dist/` は生成物。配信用アセットは`dist/site/`、Workerは`dist/worker/`。直接編集せず、ビルドで生成する。生成物はGitへ入れない。`public/data/`もVite起動時に生成する入力でGit管理外。
- 整形はOxfmt、lintはOxlint。編集後に`pnpm run format`で原本を整形し、`pnpm run check`で整形・lint・型を確認する。`pnpm test`はテスト実行のみで、この確認を含まない。生成物や式データは整形対象に加えず、整形後にビルドする。lintの抑制は理由のある最小範囲に限る。
- パッケージ管理はpnpm 12.4.1。`pnpm install`でNode.js 22.23.2とJavaScript・Pythonの依存を準備する。Python 3.11以上の本体は別途必要。JavaScriptは`pnpm-lock.yaml`、テスト用Pythonは`pyproject.toml` / `pylock.toml`で管理し、`.venv`と`.pnpm/`は生成物としてGitへ入れない。npmやpipで別の依存環境・ロックファイルを作らない。Python連携は実験機能でロックがOS・Python環境に依存するため、環境変更時は通常インストールで更新し、同じ環境の再現には`--frozen-lockfile`を使う。
- ブラウザとWorkerは同じ版の`@mathjax/src`とフォントパッケージをバンドルする（ブラウザは`src/browser/engine.ts`の遅延チャンク、Workerは`src/worker/render.ts`）。resvg WASMはWorker専用。`pnpm run check` / `pnpm test` / `pnpm run build` が基本の確認コマンド（ビルドは型チェックを含む）。`pnpm run typecheck`でも単独で確認できる。共有画像の変更時は `pnpm run test:og` も実行する。
- `pnpm run generate` は全日データの再探索。起動・表示変更だけなら実行しない。外部の検証済みデータは`pnpm run import:data DIRECTORY`で24時間分を取り込み、`data/README.md`の出典も更新する。`pnpm test`の厳密検証にはpnpmが準備するSymPyを使う。
- 既にユーザーが評価しているUIを、依頼なしに全面改装しない。

## 維持する動作

各項目は括弧内のテストが仕様として固定している。挙動を変えるときは先にそのテストを読み、規範文だけを書き換えない。**太字**の下位条項はテストが固定していないため、変更時は本文に従い目視で確認する。

- HHMM4桁はスロット0〜3で識別し（同じ数字でも別要素）、常設の数字SVG要素・連結数字の個別桁を再生成しない（tests/unit/expression.test.ts・tests/unit/symbols.test.ts・tests/browser/clock.test.ts、全ブラウザスイートの要素同一性検証）。
- 等号は常設要素を保持して移動し、`symbolMotion`オン時は同じ持ち場の基本記号を再利用して動かす（tests/browser/symbol-motion.test.ts・clock.test.ts）。**対応のない記号と装飾を別レイヤーでフェードさせる点は未固定**——`#notation-root`のクロスフェードと退出フェードを変えたら目視する。
- `structureMotion`の分数線・√・括弧の保持規則——同じ持ち場・書体・サイズバリアント・文字コードのときだけ保持、√上線は開き部分と同時交換（tests/browser/structure-motion.test.ts・tests/unit/symbols.test.ts）。**組み立て式の大型字形がフェードに残る点は間接的にしか検証されていない**。
- `symbolMorph`の＋−×÷クロスフェード規則——×は45度回転、他は横棒の向き維持、単項マイナス・分数線・別持ち場は除外、割り込みは角度・濃度を引き継ぐ（tests/browser/symbol-morph.test.ts・tests/unit/symbols.test.ts）。**スラッシュが同じ持ち場で実際に再利用される正側は未固定**（変形除外のみ検証済み）。
- 実験3設定の前提関係・独立性・disabled時の選択保持・`state.display`（選択値）と`state.layout.display`（有効値）の分離・初期値オンと保存済みオフの尊重（tests/browser/motion-settings.test.ts）。
- 式データnullは同じ数字の通常時計へ移り、取得失敗と区別する（tests/unit/data.test.ts・clock.test.ts・i18n.test.ts）。**「淡い」表示そのものはOG側（tests/helpers/og-reference.ts・og-snapshots）だけが固定**——`stage.resting`のCSSを変えたらブラウザでも目視する。
- 等号の実字形の上下中央は固定の画面座標に載せ、式全体の外接矩形で縦中央配置しない（clock.test.tsのcheckGeometry・og-parity.test.ts）。
- 字体4種×数字スタイル2種は独立設定。liningは数字中心の軸へ補正、oldstyleは本来の数式軸（clock.test.ts・og-parity.test.ts・og-snapshots）。
- 上の小さい時刻は選択中の数式フォント・6桁固定セル・要素保持（clock.test.ts）。**式の有無に応じたフェードはON/OFFのみ検証**——トランジションと高さ確保は未固定。
- 分数/÷/スラッシュの切り替えで計算の意味・数字の順序・時刻を変えない（tests/unit/expression.test.tsのroundtrip＋SymPy検証・clock.test.ts）。
- 時報は117風。周波数・長さ・重複禁止の正確な仕様はtests/browser/audio.test.tsが正。
- 時報のオン／オフ・音量の保存復元、自動再生ブロック時の選択保持と操作による再開、復元時の確認音抑制、オフ後の非同期応答での再有効化禁止（tests/browser/audio-settings.test.ts）。

## 設計の分離

- データの正規形式は `formula-clock/1` のAST。TeX文字列には置き換えない。
- 表示上の優先度と結合性は `src/shared/expression.ts` で処理する。文字列置換による分数→÷変換は行わない。
- データ取得は `getMinute(hhmm, {signal})` で統一する。埋め込みと非同期の選択をアプリ全体に持ち込まない。
- 全プロバイダーは生成側で確認済みの正規データを返す。`InlineProvider`・`TableProvider`・独自プロバイダーも同じ契約とし、返したASTを後から変更しない。`tools/validate-data.ts`を生成・取り込み・ビルドの検証に使い、検証済みASTを表示・共有・OG描画で再検証しない。
- ブラウザ用コードにソルバを含めない。値と定義域の検証は生成・テスト側の責務。
- 測定用SVGと数字パスには同じ基準の `getScreenCTM()` を使う。過去の数字消失を再発させない。
- 書体×数字スタイルごとに独立したエンジン（SVG出力とフォントインスタンス）を保ち、軸キャリブレーションを他のエンジンへ漏らさない。共通のエンジン生成は`src/shared/mathjax/pipeline.ts`、フォント定義は`src/shared/mathjax/fonts/`、軸補正の手順は`src/shared/typography.ts`に集約する。ブラウザの`engine.ts`はDOMアダプターと字形識別パッチを担当し、`fonts.ts`とともに遅延読み込みを保つ。Workerの`render.ts`は共通処理を静的importし、resvgによる測定とPNG化を担当する。
- `engine.ts`の`charNode`パッチ（`data-glyph-key`によるサイズバリアント記録）を保持する。Wrapperのprototypeは全エンジン共有のため、パッチは1回だけ当ててフォント識別は呼び出し時に解決する。MathJax更新時は構造記号のブラウザ検証も実行する。
- 古い非同期応答を破棄するserial/revision確認と、失敗時の時刻表示を維持する。
- `src/shared/`は環境から独立した契約・規則を置く。DOM向け翻訳適用と相対URL・埋め込みデータの読み込みは`src/browser/i18n.ts`・`src/browser/data.ts`、共有APIの通信とページ単位のキャッシュは`src/browser/share-client.ts`に置く。ブラウザの公開API・描画状態・診断の型は`src/browser/types.ts`に置き、`bootstrap.ts`の既存公開面を保つ。
- 画面とOGの共通色は`src/shared/palette.css`を原本とする。ブラウザはCSSとしてimportし、Workerは`palette.ts`から同じ値を読む。
- 記号マーカーの生成・解析と持ち場の対応付けは`src/shared/symbols.ts`に集約し、TeX生成側とSVG抽出側で形式を重複定義しない。
- 共有URLの解析・生成は `src/shared/share.ts` に集約し、復元でlocalStorageを書き換えない。共有時は描画済みの秒を同期的に停止し、ネイティブ共有の前に画像生成を待たない。
- 新しい共有URLは英数字10文字の`/s/<ID>`。ID発行後に202で返し、時刻・表示設定・AST（nullを含む）のKVへの期限なし保存を`ctx.waitUntil`で継続する。共有シート表示ではKV保存を待たず、タイトルはブラウザから渡す。画面とOG画像は保存済みASTから再現する。時刻操作で固定ASTを解除し、表示設定変更時はASTを保ってURLを`/`へ戻す。ID発行を待った後のネイティブ共有ではユーザー操作の有効期間を確認する。
- 共有URLは共有ボタンのクリック時に発行する。時刻・表示設定・ASTが完全一致する発行済みURLだけを再利用し、同じ発行が進行中なら要求を共有する。通常の時計更新でKVへ書き込まない。発行の失敗は通知し、クリックで再試行できる。
- 共有ページのタイトルはASTの数式テキストと秒の等式にする。OG／Twitterカードはタイトルを`Formula Clock - HH:MM:SS`、Descriptionを`-(2×3)+50=44`のような空白なしの式にする。ネイティブ共有では`title`へカードのタイトル、`url`へ共有URLだけを渡し、`text`は渡さない。URL生成中の通知は表示せず、失敗時とコピー完了の通知は保つ。除算は`/`、累乗は`^`、乗算は`×`、負号と減算は`-`。式がない場合はDescriptionに時刻を使う。
- テキスト数式の括弧はタイトル・Descriptionで共通の規則を使い、優先順位・結合順序と根号・階乗の意味を保つために必要なものだけ残す。式全体を無条件に囲まない。
- UI文言は `src/shared/i18n.ts` に集約する。ブラウザの最優先言語が日本語なら日本語、それ以外は英語。言語を共有URL・表示設定へ混ぜず、時計の数値・書体・ASTを変えない。
- 日本語UIでも一般的なWeb表記は自然に英語を使う。「字体」は「フォント」、ライセンスの見出しは「LICENSE」、読み込み表示は「Loading」。説明文やエラーの理由は分かりやすい日本語にする。現在時刻への復帰は「現在時刻へ」とし、Liveと略さない。一時停止の操作欄は左右キーの案内と現在時刻への復帰だけを表示し、再生・速度変更ボタンを置かない。左右キーは1秒移動、Spaceは一時停止／現在時刻への復帰とし、ショートカットの意味を明記する。
- ライセンス画面の説明は日本語版だけを保ち、英訳しない。ライセンス原文はそのまま掲載し、見出し・閉じる操作だけ共通UIとして扱う。
- アプリ名は読み上げ用も含めて「Formula Clock」とし、「計算時計」と訳さない。文字列リソースは実際の表示・読み上げ・通知で使うものを保ち、起動直後に置換されるだけの初期値を別リソースとして増やさない。
- ロゴは`src/worker/assets/`の固定SVGと`public/og-default.png`を使い、実行時にフォントから組み立てない。共有画像は作成時に描いて`og/shares/<ID>.png`へ保存し、不変配信する（期限切れは保存済みASTから自己修復）。クエリURL画像のキャッシュだけ`WORKER_VERSION.id`で版を分ける。
- OG描画は正規ASTから行い、任意のTeX・画像・外部URLを入力として受け付けない。R2の正常画像と短時間キャッシュの代替ロゴを混同しない。詳細は `docs/SHARING.md`。

## 検証と報告

- `pnpm test` はデータとTeX生成の検証であり、配布フォントのロード検証ではない。
- `vitest.config.ts`で`unit`・`build`・`og`を分け、`playwright.config.ts`でブラウザとサーバーの起動・終了・レポートを管理する。VitestのTypeScript変換はViteが行い、全テストの型チェックは`tsc --noEmit`で別に維持する。
- Worker統合テストはWranglerの`createTestHarness`でViteが生成した`dist/worker/wrangler.json`を使う。固定PNGの回帰検証はPlaywrightの`toMatchSnapshot`で行い、基準画像は`tests/fixtures/og-snapshots/`、実際の画像と差分は`test-results/`に保存する。
- ブラウザ検証は配布物のMathJax（バンドル済みチャンク）をそのまま使う。過去のMathJax 3や別実装による代替検証は戻さない。
- 以前のテスト結果を再実行した結果として扱わない。使用エンジン、書体、ブラウザ、実行コマンドを記録する。
- 変更後は `docs/ACCEPTANCE.md` の該当項目と、分数・指数・通常時計・書体切り替えを確認する。

## リポジトリの管理

ソース、採用済み式データ、テスト入力、説明、説明用PNG見本をGit管理する。`dist/`と`test-results/`は再生成可能な出力なのでGit管理しない。
ブラウザとWorkerは同じ版のMathJax・フォントデータをバンドルし、ライセンス表示を維持する。

- `docs/`には継続して参照する仕様・運用手順・確認項目を置く。作業ごとのverificationディレクトリや引き継ぎ報告書を増やさない。
- テストは`tests/README.md`の役割別ディレクトリに置く。生ログ・実行結果JSON・確認用スクリーンショットは、Git対象外の`test-results/`に保存し、`tests/`へ出力しない。実行結果は必要な範囲を回答やコミットに要約する。
- 変更は確認できたまとまりごとにGitへコミットする。複数の依頼の変更を未コミットのまま溜めない。

# このプロジェクトで作業するエージェントへ

使い方と開発手順は `README.md`、データとAPIの仕様は `docs/FORMAT.md`。このファイルは実装で守る要点。
後続のユーザー指示による仕様変更は、その指示を優先する。

## 編集とビルド

- 表示アプリの原本は`src/browser/`（マークアップ`index.html`・CSS`styles.css`・合成ルート`app.ts`・役割別モジュール`dom.ts` / `audio.ts` / `data-source.ts` / `settings.ts` / `renderer.ts` / `clock.ts` / `sharing.ts` / `fullscreen.ts` / `shortcuts.ts` / `typesetter.ts`）と`src/shared/`（`i18n.ts` / `display.ts` / `share.ts` / `expression.ts` / `data.ts` / `symbols.ts`）。ビルド時に`<!-- clock-licenses -->`へライセンス表示を挿入する。共有画像と配信処理は `src/worker/`。
- ライセンスの取得先・SHA-256・出典・確認済みの依存版は`licenses/`で管理し、`tools/licenses.ts`で生成する。本文は取得してGit管理外の`licenses/texts/`へキャッシュする。通常ビルドでも自動生成し、`pnpm run generate:licenses`で単独確認できる。更新時は`licenses/README.md`に従い、配布物と照合してから確認済み版とハッシュを更新する。
- アプリ・Worker・ビルドツール・テストはTypeScriptのES Modules。単体・ビルド・OG検証はVitest、ブラウザ検証はPlaywright Testで実行し、PythonはSymPyの厳密計算だけに使う。共通の型は `src/shared/types.ts`、ブラウザ固有の型は `src/browser/types.ts` / `src/browser/globals.d.ts`。`strict`を保ち、外部JSONの実行時検証を型アサーションだけで置き換えない。
- モジュール間の依存はESモジュールのimportで宣言する。`bootstrap.ts`の`window`公開はブラウザテスト・コンソール用の公開面で、アプリ内部の参照には使わない。ブラウザの各モジュールは`createX(deps)`ファクトリでモジュールトップレベルの副作用を持たず、合成順序・リスナー登録順（ショートカット→時報再開のkeydown）は`app.ts`が管理する。遅延バインドのクロージャはイベント・Promise継続・タイマーからのみ発火させる。世代カウンタ（`dataRevision` / `requestSerial` / `shareSerial` / `TimeSignal.revision`）はガードと継続を同一モジュール内に保つ。ビルドはVite、Worker・WASM・配布設定はCloudflare公式プラグインを使う。`tools/vite-clock.ts`には式データとライセンス固有の処理だけを置き、独自バンドラーやWASMローダーを追加しない。
- `dist/` は生成物。配信用アセットは`dist/site/`、Workerは`dist/worker/`。直接編集せず、ビルドで生成する。生成物はGitへ入れない。`public/data/`もVite起動時に生成する入力でGit管理外。
- 整形はOxfmt、lintはOxlint。編集後に`pnpm run format`で原本を整形し、`pnpm run check`で整形・lint・型を確認する。`pnpm test`はテスト実行のみで、この確認を含まない。生成物や式データは整形対象に加えず、整形後にビルドする。lintの抑制は理由のある最小範囲に限る。
- パッケージ管理はpnpm 12.4.1。`pnpm install`でNode.js 22.23.2とJavaScript・Pythonの依存を準備する。Python 3.11以上の本体は別途必要。JavaScriptは`pnpm-lock.yaml`、テスト用Pythonは`pyproject.toml` / `pylock.toml`で管理し、`.venv`と`.pnpm/`は生成物としてGitへ入れない。npmやpipで別の依存環境・ロックファイルを作らない。Python連携は実験機能でロックがOS・Python環境に依存するため、環境変更時は通常インストールで更新し、同じ環境の再現には`--frozen-lockfile`を使う。
- ブラウザとWorkerは同じ版の`@mathjax/src`とフォントパッケージをバンドルする（ブラウザは`src/browser/engine.ts`の遅延チャンク、Workerは`src/worker/render.ts`）。resvg WASMはWorker専用。`pnpm run check` / `pnpm test` / `pnpm run build` が基本の確認コマンド（ビルドは型チェックを含む）。`pnpm run typecheck`でも単独で確認できる。共有画像の変更時は `pnpm run test:og` も実行する。
- `pnpm run generate` は全日データの再探索。起動・表示変更だけなら実行しない。外部の検証済みデータは`pnpm run import:data DIRECTORY`で24時間分を取り込み、`data/README.md`の出典も更新する。`pnpm test`の厳密検証にはpnpmが準備するSymPyを使う。
- 既にユーザーが評価しているUIを、依頼なしに全面改装しない。

## 維持する動作

- HHMMの4桁は値でなくスロット0〜3で識別する。同じ数字があっても別要素。
- 秒が変わっても常設の数字SVG要素を再生成しない。連結数字も個々の桁として保持する。
- 等号は数字と同様に常設要素を保持して移動させる。実験設定 `symbolMotion` のオン時は同じ持ち場の基本記号も再利用して移動し、対応のない記号と装飾は別の層でフェードさせる。
- 実験設定 `structureMotion` は分数線・√・括弧が対象。√と括弧は同じ持ち場・書体・サイズバリアント・文字コードの場合だけ保持する。√の上線は開き部分と同時に交換し、組み立て式の大型字形はフェードを維持する。
- 実験設定 `symbolMorph` は同じ桁の境界・同じ書体の＋・−・×・÷の全組み合わせをクロスフェードでつなぐ。×との交換は45度回転し、他の3記号は横棒の向きを保つ。単項マイナス・分数線などや別の持ち場は対象外。割り込み時も現在の角度と濃さを引き継ぎ、最後は本来の字形へ戻す。スラッシュは同じ持ち場での再利用だけを行い、四則記号間の変形には含めない。
- 実験設定 `structureMotion` と `symbolMorph` は、いずれも `symbolMotion` を前提にし、互いには独立して設定できる。`symbolMotion` がオフでも両方の選択値を保持し、チェックされたままdisabledにできる。描画時だけ両方を無効にし、再びオンにすると選択どおりの動作へ戻す。保存設定・`setDisplay`・`state.display`は選択値、`state.layout.display`は描画に有効な値を扱う。
- 実験設定3項目の初期値はすべてオン。保存済みの明示的なオフは維持し、未保存の項目だけ初期値を使う。
- 式データがnullなら、同じ数字で淡いHH:MM:SSに移る。取得失敗とは区別する。
- 等号の実字形の上下中央を一定の画面座標に固定する。式全体の外接矩形で縦中央配置しない。
- 字体4種（STIX Two / Termes / Fira / Euler）と数字スタイル（lining / oldstyle）は独立設定。初期値はSTIX Two + oldstyle。全書体のliningで数字中心へ軸・記号を補正し、oldstyleは本来の数式軸を使う。
- 上の小さい時刻も選択中の数式フォントを使う。6桁を固定幅で保持し、コロンと桁位置を変えず、式の有無に応じてフェードする。
- 分数/÷/スラッシュの切り替えでも計算の意味、数字の順序、時刻を変えない。
- 時報は117風。通常の秒音2000 Hz / 7 ms、各30秒の直前3音500 Hz / 50 ms、10秒ごとの時報1000 Hz / 1350 msを維持する。プレビュー操作と音のオン/オフに連動し、同じ秒を重複して鳴らさない。
- 時報のオン／オフと音量を保存・復元する。ブラウザが自動再生を止めてもオンの選択を保持し、ユーザー操作で再開する。復元時は有効化の確認音を鳴らさず、待機中にオフにした後の非同期応答で勝手にオンへ戻さない。

## 設計の分離

- データの正規形式は `formula-clock/1` のAST。TeX文字列には置き換えない。
- 表示上の優先度と結合性は `src/shared/expression.ts` で処理する。文字列置換による分数→÷変換は行わない。
- データ取得は `getMinute(hhmm, {signal})` で統一する。埋め込みと非同期の選択をアプリ全体に持ち込まない。
- ブラウザ用コードにソルバを含めない。値と定義域の検証は生成・テスト側の責務。
- 測定用SVGと数字パスには同じ基準の `getScreenCTM()` を使う。過去の数字消失を再発させない。
- 書体×数字スタイルごとに独立したエンジン（SVG出力とフォントインスタンス）を保ち、軸キャリブレーションを他のエンジンへ漏らさない。エンジン生成は`src/browser/engine.ts`に集約し、Workerの`render.ts`と構成を揃える。
- `engine.ts`の`charNode`パッチ（`data-glyph-key`によるサイズバリアント記録）を保持する。Wrapperのprototypeは全エンジン共有のため、パッチは1回だけ当ててフォント識別は呼び出し時に解決する。MathJax更新時は構造記号のブラウザ検証も実行する。
- 古い非同期応答を破棄するserial/revision確認と、失敗時の時刻表示を維持する。
- 共有URLの解析・生成は `src/shared/share.ts` に集約し、復元でlocalStorageを書き換えない。共有時は描画済みの秒を同期的に停止し、ネイティブ共有の前に画像生成を待たない。
- 新しい共有URLは英数字10文字の`/s/<ID>`。ID発行後に202で返し、時刻・表示設定・AST（nullを含む）のKVへの期限なし保存を`ctx.waitUntil`で継続する。共有シート表示ではKV保存を待たず、タイトルはブラウザから渡す。画面とOG画像は保存済みASTから再現する。時刻操作で固定ASTを解除し、表示設定変更時はASTを保ってURLを`/`へ戻す。ID発行を待った後のネイティブ共有ではユーザー操作の有効期間を確認する。
- 共有URLは共有ボタンのクリック時に発行する。時刻・表示設定・ASTが完全一致する発行済みURLだけを再利用し、同じ発行が進行中なら要求を共有する。通常の時計更新でKVへ書き込まない。発行の失敗は通知し、クリックで再試行できる。
- 共有ページのタイトルはASTの数式テキストと秒の等式にする。OG／Twitterカードはタイトルを`Formula Clock - HH:MM:SS`、Descriptionを`-(2×3)+50=44`のような空白なしの式にする。ネイティブ共有では`title`へカードのタイトル、`url`へ共有URLだけを渡し、`text`は渡さない。URL生成中の通知は表示せず、失敗時とコピー完了の通知は保つ。除算は`/`、累乗は`^`、乗算は`×`、負号と減算は`-`。式がない場合はDescriptionに時刻を使う。
- テキスト数式の括弧はタイトル・Descriptionで共通の規則を使い、優先順位・結合順序と根号・階乗の意味を保つために必要なものだけ残す。式全体を無条件に囲まない。
- UI文言は `src/shared/i18n.ts` に集約する。ブラウザの最優先言語が日本語なら日本語、それ以外は英語。言語を共有URL・表示設定へ混ぜず、時計の数値・書体・ASTを変えない。
- 日本語UIでも一般的なWeb表記は自然に英語を使う。「字体」は「フォント」、ライセンスの見出しは「LICENSE」、読み込み表示は「Loading」。説明文やエラーの理由は分かりやすい日本語にする。現在時刻への復帰は「現在時刻へ」とし、Liveと略さない。一時停止の操作欄は左右キーの案内と現在時刻への復帰だけを表示し、再生・速度変更ボタンを置かない。左右キーは1秒移動、Spaceは一時停止／現在時刻への復帰とし、ショートカットの意味を明記する。
- ライセンス画面の説明は日本語版だけを保ち、英訳しない。ライセンス原文はそのまま掲載し、見出し・閉じる操作だけ共通UIとして扱う。
- アプリ名は読み上げ用も含めて「Formula Clock」とし、「計算時計」と訳さない。文字列リソースは実際の表示・読み上げ・通知で使うものを保ち、起動直後に置換されるだけの初期値を別リソースとして増やさない。
- ロゴは`src/worker/assets/`の固定SVGと`public/og-default.png`を使い、実行時にフォントから組み立てない。画像キャッシュの描画版はCloudflareの`WORKER_VERSION.id`を使う。
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

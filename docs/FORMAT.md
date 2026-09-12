# Formula Clock — 式データと表示の仕様（r6）

## 受け渡すもの

受け渡しの正規形式は **JSONで表した式の構文木（AST）**。TeXは保存形式にせず、表示設定を適用するときに生成する。

```text
事前計算・外部のソルバ
  → JSONの構文木
  → データ取得インターフェース
  → 構文木からTeXへ変換（フォント・除算表記・括弧）
  → MathJaxで組版
  → SVGの字形と配置を取得
  → 同じ数字オブジェクトを移動
```

構文木には演算の意味と元の桁への参照を記録する。括弧、色、TeXマクロ、フォント、分数線か「÷」「/」か、といった表示の指定は記録しない。

TeXを受け取る形式だと、分数を「÷」へ変える前にTeXを解析し直す必要がある。数字の文字列だけからは、同じ数字が複数現れたときの元の桁も決まらない。構文木なら、その両方を保存できる。

## 1. 構文木

```ts
type Expr =
  | { op: 'lit'; i: number; j: number }
  | { op: 'neg' | 'sqrt' | 'fact'; a: Expr }
  | { op: 'add' | 'sub' | 'mul' | 'div' | 'pow'; a: Expr; b: Expr };
```

### 数字は値でなくHHMMの位置を参照

`lit` はゼロ始まり、終端を含まない区間 `[i, j)` を表す。`HHMM = "1234"` の場合：

| 構文木                            | 表示される数字 | アニメーション上の同一性 |
| --------------------------------- | -------------- | ------------------------ |
| `{ "op": "lit", "i": 0, "j": 1 }` | `1`            | HHMMの0番目              |
| `{ "op": "lit", "i": 0, "j": 2 }` | `12`           | 0番目と1番目の2個        |
| `{ "op": "lit", "i": 2, "j": 4 }` | `34`           | 2番目と3番目の2個        |

`12` を1個の画像や文字要素にまとめない。TeX生成時にそれぞれの数字へ識別子を付けるため、次の式で `1 + 2` に分かれても同じ2個の数字を使う。

r4の規則は、左から順番に4桁を各1回使うこと。`i < j`、`0 ≤ i < 4`、`1 ≤ j ≤ 4`。複数桁の数の先頭0は認めない。数の値自体、追加の定数、文字列のTeXは構文木に含めない。

### 演算

`add/sub/mul/div/pow` は、それぞれ `a+b`、`a−b`、`a×b`、`a/b`、`a^b`。`neg/sqrt/fact` は、`−a`、主平方根、階乗を表す。

「÷で表示する」という設定は `div` の意味を変更しない。平方根と階乗にも表示専用の別演算は作らない。

### 完全な式の例

12:34:08を表せる `12 ÷ 3 + 4 = 08` の**左辺**：

```json
{
  "op": "add",
  "a": {
    "op": "div",
    "a": { "op": "lit", "i": 0, "j": 2 },
    "b": { "op": "lit", "i": 2, "j": 3 }
  },
  "b": { "op": "lit", "i": 3, "j": 4 }
}
```

同じ構文木を分数モードでは `\frac{12}{3}+4` に変換する。等号と右辺の秒はフロントエンドで付ける。

## 2. 1分分のレコード

```ts
interface MinuteRecord {
  schema: 'formula-clock/1';
  hhmm: string; // '0000'～'2359' の有効な時刻
  seconds: (Expr | null)[]; // 必ず60個、添字が00～59秒
}
```

- `seconds[8]` に、上の構文木を入れると12:34:08で表示される。
- `null` は、その秒に提供する式がないという指定。淡い `HH:MM:SS` を表示する。
- レコードの欠落、通信失敗、JSONの不正、配列の要素不足は、`null` と区別する。画面は時刻表示を継続し、データ取得の失敗を別に表示する。

`null` は、その数を数学的に作れないという証明を意味しない。

完全な60要素の例は `data/examples/1234.json`。配列内の `...` のような省略記法はJSONとして受け付けない。

## 3. 複数の分をまとめる形式

```ts
interface FormulaTable {
  schema: 'formula-clock/1';
  minutes: Record<string, (Expr | null)[]>;
}
```

`minutes["1234"]` が上の60要素の配列になる。1日分は1,440キー、86,400秒。時刻に日付やタイムゾーンは含めない。時計は端末のローカル時刻からHHMMと秒を決めて、この表を参照する。

`data/expressions.json` に1日分の生成済みデータ、`data/examples/table.json` に12:34だけを持つサンプルがある。部分的な表も受け取れるが、ない分を要求すると欠落エラーになる。

## 4. 配信方法に依存しないインターフェース

```ts
interface FormulaProvider {
  getMinute(hhmm: string, options?: { signal?: AbortSignal }): Promise<MinuteRecord>;
}
```

時計は現在の1分分を取得し、次の分も先読みする。直近のレコードを保持する。データ提供元を変更したときは進行中の取得を中止し、古い提供元から遅れて返ってきた結果を採用しない。

### 既にメモリ上にあるJSON

```js
FormulaClock.setDataProvider(new FormulaData.InlineProvider(table));
```

### HHMMごとのJSONを非同期で取得

```js
FormulaClock.setDataProvider(
  new FormulaData.FetchMinuteProvider((hhmm) => `/expressions/${hhmm}.json`),
);
```

各URLは `MinuteRecord` を返す。サーバー側で必要ならHTTP圧縮する。

### 全日分のJSONを一度だけ非同期で取得

```js
FormulaClock.setDataProvider(
  new FormulaData.TableProvider(async () => {
    const response = await fetch('/expressions.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }),
);
```

`TableProvider` は取得処理を共有する。1分分の利用者が中止しても、共有中の全日データの取得を巻き添えにしない。失敗した取得は次の要求で再試行できる。

### 起動前に指定

`src/browser/main.ts`は`bootstrap.ts` → `provider.ts` → `app.ts`の順にモジュールを実行する。初期プロバイダーを変更する場合は`src/browser/provider.ts`で指定する。`FormulaData`などの公開APIはこの時点で準備済み。先に設定済みの`window.FORMULA_CLOCK_CONFIG`は既定のプロバイダーで上書きしない。

```js
window.FORMULA_CLOCK_CONFIG = {
  provider: new FormulaData.FetchMinuteProvider((hhmm) => `data/minutes/${hhmm}.json`),
};
```

設定画面のファイル読み込み・復元操作は一旦取り外している。外部データの指定と提供元の差し替えには上記APIを使用する。

## 5. 優先度と結合性

TeX生成は `src/shared/expression.ts` に集約した。表示上の優先度は次のとおり。

| 弱い → 強い | 表記                                 |
| ----------- | ------------------------------------ |
| 1           | `+ −`                                |
| 2           | `× ÷ /`（左結合）                    |
| 3           | 単項の負号                           |
| 4           | 累乗                                 |
| 5           | 階乗                                 |
| 6           | 数字、平方根、分数線でまとまった分数 |

分数線は分子・分母の範囲を明示する。`÷` と `/` にはそれがないので、同じ構文木でも必要な括弧が変わる。

| 意味          | ÷での表示     |
| ------------- | ------------- |
| `a / (b + c)` | `a ÷ (b + c)` |
| `a / (b / c)` | `a ÷ (b ÷ c)` |
| `(a / b) / c` | `a ÷ b ÷ c`   |
| `a / (b × c)` | `a ÷ (b × c)` |
| `a × (b / c)` | `a × (b ÷ c)` |
| `a − (b − c)` | `a − (b − c)` |

加算だけ、乗算だけの連鎖では、結合の違いによる括弧を省略する。減算・除算を含む右側の部分式は保守的に括弧を残し、木の意味を維持する。分配・約分・負号の移項などの代数的変形はしない。

負の底は `(-a)^b`、二度の階乗は `(a!)!`。`a!!` は別の慣用的な意味になるため出力しない。指数の部分式はTeXの指数グループで範囲を保持する。

根号を累乗の底にするときは、上線が底の範囲を示すため外側の括弧を省く。02:20:33は `0! + {\sqrt{\sqrt{2}}}^{20} = 33` とし、指数は根号の外側に置く。上線を持たないテキスト表記では、累乗の対象を明示する括弧を残す。

根号全体に階乗が付くときは、`!`の適用範囲を読み取りやすくするため根号を括弧で囲む。08:58:46は `(\sqrt{0!+8})! + 5×8 = 46` とし、根号内の`0!`と根号全体の階乗を区別する。

## 6. フォントは別の表示設定

```js
await FormulaClock.setDisplay({ font: 'stix2', numerals: 'oldstyle', division: 'inline' });
await FormulaClock.setDisplay({ font: 'euler', numerals: 'lining', division: 'fraction' });
```

除算スタイルは`division: fraction | inline | slash`。`fraction`は分数、`inline`は÷、`slash`は/を表示し、後者2つは同じ優先度・括弧の規則を使う。共有URL・KV・OG画像でも3種類を保持する。

字体は `stix2` / `termes` / `fira` / `euler`、数字スタイルは独立した `numerals: lining | oldstyle`。初期値は `stix2` + `oldstyle`。Eulerは `mathjax-modern` に `mathjax-euler` 拡張を追加し、ほかは対応するMathJaxフォントを使う。全書体のliningでは、0の実字形の中心から数式軸を求め、記号を `\vcenter` で合わせる。oldstyleは各数字に `\oldstyle` を指定し、記号と構造には書体本来の数式軸を使う。等号の画面上の縦位置は全組み合わせで固定する。

書体と数字スタイルの組み合わせごとにエンジンと小時計の字形をキャッシュする。設定・上の時計・式の非同期更新も両方を区別する。字体のみ変更すると数字スタイルは維持する。

異なるフォント・除算表記でもデータを取り直す必要はない。TeXと組版結果のキャッシュは表示設定を区別する。

実験設定`symbolMotion`・`structureMotion`・`symbolMorph`の初期値はすべて`true`。
保存済みの`false`は維持し、未保存の項目はオンで始める。描画時の前提条件と選択値の保存は従来どおり分ける。

## 7. 検証の境界

`data/schema.json` がJSON Schema、`src/shared/types.ts`が共通のTypeScript型、`src/api.d.ts`が公開型の入口。実装も同じ型を使う。スキーマの配列サイズや演算の形に加えて、実行時に次を検証する。

- HHMMが有効な24時間制の時刻で、要求した分と一致すること。
- 60秒分の要素があり、各構文木が4桁を順番に各1回参照すること。
- リテラルの区間、演算名、フィールドが正しく、過大な深さや循環参照がないこと。

**数式の計算結果が秒に一致することは、データ生成側の責任**。ブラウザには探索ソルバも計算結果の検証器も含めない。同梱データは`tests/unit/expression.test.ts`で全式を厳密計算し、探索用ソルバの範囲を超える式は`tests/helpers/verify-exact.py`のSymPyで確認する。浮動小数点の近似一致は採用しない。0の0乗・0除算・非実数の途中結果・整数でない階乗は認めない。外部データの出典・更新方法は[data/README.md](../data/README.md)を参照。

このデータを差し替える場合も、生成側で演算の定義域と計算結果を確認してから渡す。追加演算や桁の並べ替えを導入するときは、スキーマとTeX生成器の双方を更新する。

## 8. 1時間単位の配信（r6）

配信用ビルドは `data/manifest.json` と `data/hours/HH.<sha256>.json`（24個）を生成する。
時間別JSONは `FormulaTable` の部分集合で、該当時間の60分をすべて含む。

```js
new FormulaData.FetchHourProvider('data/manifest.json');
```

目録の形式は `schema: "formula-clock-hours/1"`、`version`（64桁のSHA-256）、
`hours`（"00"〜"23"をURLへ対応させるオブジェクト）。URLは目録の応答URLから解決する。
版はURLマップから、時間別ファイル名は各JSON本文から計算する。

同じ時間帯の取得を共有し、取得済み時間はLRUで2時間保持する。
個別のAbortSignalはその利用者だけを中止する。共有ダウンロードは継続できる。
59分の翌分先読みで次の時間帯も取得する。通常時計では59分00〜30秒にランダムに分散し、
表示中の時刻に必要な取得とプレビューの先読みは待たせない。URLは全利用者で共通のままにする。
失敗した要求は保持せず再試行できる。

時間別URLが404なら目録を再検証する。版が変わっていれば時間キャッシュを空にし、
新URLで一度だけ再試行する。更新前の遅い応答は採用しない。
同じ版や再試行失敗は通常の取得エラーとして表示側へ返す。nullには変換しない。

公開書体IDは `stix2` / `termes` / `fira` / `euler` の4種類。旧 `oldstyle` 書体設定は初期値の `stix2` へ戻す。`numerals` が未保存なら旧Eulerはlining、それ以外はoldstyleへ移行する。
独立iframe・数字スタイルごとの軸設定・各書体本来の数字の字形を維持する。

## 9. 共有URLとOG画像

共有状態の正規URLは `/s/<ID>`。IDは暗号学的乱数から作る英大文字・英小文字・数字の10文字。
`-`・`_`は使わず、62文字からの選択には剰余による偏りを避ける棄却法を使う。

```text
/s/aB3x7Kp2Qm
```

`POST /api/shares`へ`Content-Type: application/json`で次のスナップショットを送る。
`SharedSnapshot`の`ast`は正規`formula-clock/1`の式木、または通常時計を表す明示的な`null`。

```json
{
  "v": 1,
  "t": "123421",
  "font": "stix2",
  "numerals": "oldstyle",
  "division": "fraction",
  "ast": {
    "op": "mul",
    "a": {
      "op": "add",
      "a": { "op": "lit", "i": 0, "j": 1 },
      "b": { "op": "lit", "i": 1, "j": 2 }
    },
    "b": { "op": "add", "a": { "op": "lit", "i": 2, "j": 3 }, "b": { "op": "lit", "i": 3, "j": 4 } }
  }
}
```

`t`はASCIIのHHMMSS（00:00:00〜23:59:59）。日付やタイムゾーンを表さない。
音・アニメーション設定・言語は含めない。時刻・表示列挙値・ASTの構造・スロット順序を実行時に検証する。
入力は16 KiB以下で、未知のフィールドやTeX・外部URL・画像を受け付けない。
異なるOriginからのブラウザ要求は拒否する。IDはサーバーで生成し、利用者は指定できない。
Workerは入力検証とID発行後に`202 {"id":"…"}`と`Location: /s/<ID>`を返す。`SHARES` KVの`share/<ID>`への期限なし保存は`ctx.waitUntil`で継続し、応答は書き込み完了を待たない。
書き込みが失敗した場合は1秒・2秒後に同じIDと内容で再試行する（最大3回）。`202`は受理を表し、保存完了の保証ではない。保存前のアクセスでは404になり得る。成否はWorkerの`share-store`ログへ記録する。
保存済みレコードを書き換えるAPIは提供しない。

`src/shared/share.ts`の`FormulaShare.snapshot(value)`・`view(value)`で外部入力を検証し、`id(path)`・`shortUrl(origin,id)`でURLを扱う。
Workerは`/s/<ID>`のHTMLへ検証済みスナップショットを埋め込み、画面とOG画像の両方がその式木を使う。
式データの更新・取得失敗・リサイズがあっても共有表示の式木と`null`を保つ。
復元は保存設定を読み取った後、最初の組版エンジンを選ぶ前に行い、localStorageへ書き戻さない。
プレビューは停止状態で始まり、共有時も最後に描画を適用した時刻・設定・式木を同期的に停止・確定する。
ID発行後に共有し、通信中にユーザー操作の有効期間が切れていれば共有・コピーのボタン付きURLを表示する。KV保存と画像生成は待たない。タイトルは表示中のスナップショットからブラウザで作り、`navigator.share({title,url})`へ渡す。生成中の通知は表示せず、失敗時とコピー完了だけ通知する。
保存の発行は共有ボタンのクリック時に行い、通常の秒更新では保存しない。
`FormulaShare.LinkCache`は時刻・表示設定・ASTをキーに12件まで保持する。IDが発行済みならクリックと同期して共有し、発行要求中なら同じPromiseを待つ。状態変更で未完了の発行要求を取り消し、完全一致する発行済みURLは再利用できる。サーバーが受理したKV保存は継続する。
同じ画面の再共有では作成済みのリンクを使う。ID発行の失敗は再試行でき、時刻や設定の操作後に古い共有処理を表示しない。受理後のKV保存失敗はブラウザへ通知しない。

左右キーによる秒の移動・秒／時刻の指定・現在時刻への復帰・表示設定変更時に、`history.replaceState`でURLを`/`へ戻す。
画面遷移や履歴の追加は行わない。表示設定の変更だけなら停止中の式木を保ち、時刻操作で現在の式データに戻る。
設定画面を開くだけの操作や音量変更では共有URLを保つ。

以前の`/?v=1&t=235334&font=stix2&numerals=oldstyle&division=fraction`も読み込める。
この形式は`parse(url)`・`url(origin,state)`で扱い、過去の式木を持たないため現在のデータを使う。
旧形式では`v`省略を1、表示の不正値をstix2・oldstyle・fractionとする。共有ボタンは常に新形式を生成する。

Workerは`/`・`/s/<ID>`のHTMLへOG・Twitter Card・canonicalを挿入し、`/s/<ID>/og.png`で保存した式木の画像を配信する。
ページのタイトルは`FormulaShare.title(state)`で作る数式のテキスト表記。
`state.ast`がある場合は優先順位と結合順序に必要な括弧だけを付け、除算を`/`、累乗を`^`で表して秒との等式にする（例：`12 / 3 + 4 = 8`）。
表示の分数／÷／スラッシュ設定には影響されない。式がない場合は`Formula Clock — HH:MM:SS`。旧形式は現在データのASTを使い、取得失敗時は時刻に戻す。
OG／Twitterカードは`FormulaShare.card(state)`で作り、タイトルは`Formula Clock - HH:MM:SS`、Descriptionは空白なしの数式にする。
ネイティブ共有でも同じ`FormulaShare.card(state)`を使い、`navigator.share`へカードのタイトルと共有URLだけを渡す。`text`は渡さず、数式は共有先のOG画像・Descriptionで扱う。
`src/shared/expression.ts`の`compact(ast,code)`で結合の意味を保つ括弧を付け、`+`・`-`・`×`・`/`・`^`を使う（例：`-(2×3)+50=44`）。式がない場合のDescriptionは`HH:MM:SS`。
`plain`と`compact`は同じ括弧の規則を使う。式全体や単独の数字は囲まず、加算だけ・乗算だけの連鎖と右結合の累乗は省略できる（`1^2^3`）。減算・除算を含む右辺、累乗の左辺の累乗（`(1^2)^3`）、負の底、複合式の根号は必要な括弧を残す。テキストには根号の上線がないため、`(√4)^2`と`√(4^2)`、`(√4)!`と`√(4!)`を区別し、連続階乗も`(4!)!`のままにする。TeXの配置やAST自体は変えない。
旧形式の`/og.png`も維持する。画像URLの描画版`r`はキャッシュの更新用で、過去の描画版を指定するAPIではない。
`renderOg({state,ast})` は正規ASTからPNGを返す、Cloudflareのストレージに依存しない処理。

`FetchHourProvider(manifestUrl, {fetch})` の任意の第2引数で取得関数を差し替えられる。
旧形式のOG画像ではASSETS bindingを使い、既存の`getMinute(hhmm, {signal})`契約とキャッシュ・中止処理を維持する。

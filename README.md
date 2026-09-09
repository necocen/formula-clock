## 実験機能：記号の移動

設定の「記号も動かす（実験的）」で、`＋ − × ÷ !` を次の数式へ引き継いで移動できます。
初期値はオフ。設定はブラウザに保存し、いつでも従来のフェード表示へ戻せます。
等号はこの設定にかかわらず常に移動します。

パート2は「分数・√・括弧も動かす（実験的2）」で独立してオンにできます（初期値はオフ）。
分数線と√の上線は位置と長さを補間します。√の開き部分と括弧は、持ち場に加えて
フォント・MathJaxのサイズバリアント・文字コードが同じ場合だけ字形を保持します。
√のサイズが変わるときは、開き部分と上線を一緒にフェードさせます。
複数の部品から組み立てる極端に大きな√・括弧は、従来どおりフェード表示します。

パート3は「四則記号を変形する（実験的3）」。同じ桁の境界で `＋・−・×・÷` が入れ替わる全組み合わせに対応します。
字形の中心を揃えてクロスフェードし、×との交換では45度回転、＋・−・÷同士では横棒の向きを保ちます。
最後はフォント本来の字形になります。初期値はオフで、パート1・2とは独立して使えます。
別の持ち場・別の書体・単項マイナス・分数線などとの交換には適用しません。
途中で反転したり第三の記号へ変わっても現在の角度と濃さから再開し、reduced-motionでは変形しません。

```js
await FormulaClock.setDisplay({symbolMotion: true});
await FormulaClock.setDisplay({structureMotion: true});
await FormulaClock.setDisplay({symbolMorph: true});
```

記号は同じ持ち場に残る場合だけ引き継ぎます。二項演算子はHHMMの同じ桁の境界、
階乗・単項マイナスは対象となる同じ桁の範囲に結び付けます。
`1−2＋3` → `1＋2−3` のような交換や、別の桁への階乗の付け替えはフェードで表示します。
数式データとMathJaxによる最終配置は変わりません。
同じ記号でも役割が変わる場合があるため、移動は数式の等価変形を示すものではありません。

```sh
npm test
npm run build
npm run build:external
python tests/browser.test.py --url http://127.0.0.1:8000/dist-external/ --symbol-motion --structure-motion --symbol-morph
python tests/symbol-motion.browser.py --url http://127.0.0.1:8000/dist-external/
python tests/structure-motion.browser.py --url http://127.0.0.1:8000/dist-external/
python tests/symbol-morph.browser.py --url http://127.0.0.1:8000/dist-external/
python tests/audio.browser.py --url http://127.0.0.1:8000/dist-external/
```

以下はr5時点の引き継ぎ資料です。現行UIは右上の設定に集約され、書体はSTIX Two / Eulerの2種類、
配信用ビルドは1時間単位の24ファイルを生成します。現在の形式は[FORMAT.md](FORMAT.md)を参照してください。

---

# Formula Clock — STIX Two（r5）

**Codex引き継ぎ版：まず [CODEX_HANDOFF.md](CODEX_HANDOFF.md) を読む。** [AGENTS.md](AGENTS.md) に作業上の要点、[検証記録](docs/VERIFICATION.md) に確認済み範囲をまとめた。
この下はSTIX Two版の既存README。今回の引き継ぎで時計本体の動作は変更していない。

HHMMの4桁からSSを表す数式を表示する時計。r4の事前生成データ・数式ツリー・数字の同一性を維持するアニメーションを引き継ぎ、STIX Twoのオールドスタイル数字を追加した。

## 時報

音をオンにすると、117風の秒音・予告音・時報音を鳴らします（音声アナウンスはありません）。
通常の秒は2000 Hz / 7 ms、27・28・29秒と57・58・59秒は500 Hz / 50 ms、
00・10・20・30・40・50秒は1000 Hz / 1350 msです。短音は素早く切り、時報音には減衰する余韻を付けています。
周波数は[AGCの解説](https://www.asahiglassplaza.net/gp-pro/knowledge/vol5_sub.html)、
長さは[再現キットの仕様・3ページ](https://akizukidenshi.com/goodsaffix/manu006.pdf)を参考に、時報音を聴感に合わせて1.5倍に延ばしています。NTT公式規格の完全再現ではありません。
音量・オン／オフ・プレビューの再生／停止に連動し、0.5倍速でも音程と音の長さは変えません。

## 表示

初期書体は **STIX Two · Oldstyle**。下部の「字体」でEuler、Computer Modern · Oldstyleへ切り替えられる。「6と9を見る」は16:39:19の `1 + 6 + 3 + 9 = 19` を静止表示する。「再生」でその先の秒へ進む。

STIX Two / Computer Modernはフォント本来の数式軸を使う。Eulerは従来どおり数字中央へ演算子を調整する。すべての書体で等号の縦位置を固定する。分数／÷、解のない秒の淡いHH:MM:SS表示、時報は従来どおり。

書体と除算表記をlocalStorageの `formula-clock-display-v2` に保存する。r4の保存書体とはキーを分けたため、この版を最初に開いたときにはSTIX Twoになる。

## 起動と公開

`index.html` をブラウザで開くか、静的ホスティングにそのまま配置する。式データはgzip＋base64で埋め込まれており、ブラウザでは探索しない。MathJax 4.1.3と選択したフォントのデータはCDNから取得するため、初回読み込みにはインターネット接続が必要。

```sh
npm run build
```

生成物は `index.html`。Node.js 20以上で外部npmパッケージなしにビルドできる。フォントファイルは同梱しない。

## 書体の実装

`typesetter.js` のプロファイルを追加した。

```js
stix2: {
  id: 'stix2',
  label: 'STIX Two · Oldstyle',
  font: 'mathjax-stix2',
  extensions: [],
  oldstyle: true,
  centerOperators: false,
  numericAxis: false
}
```

数字には `\\oldstyle` を使い、MathJaxのSTIX2フォントセットに組版させる。各書体は独立した非表示iframeのMathJaxインスタンスで処理する。Eulerの拡張や数式軸設定がSTIX Twoへ混入しない。表示側の数字要素は切り替え前後で同一。

```js
await FormulaClock.setDisplay({font: 'stix2', division: 'inline'});
```

## 式データと非同期配信

データ形式とプロバイダーAPIはr4から変更なし。詳細は `FORMAT.md`、型定義は `api.d.ts`、検証用スキーマは `formula.schema.json`。

```js
FormulaClock.setDataProvider(
  new FormulaData.FetchMinuteProvider(hhmm => `/expressions/${hhmm}.json`)
);
```

1分ごとのJSONを使う配信版を生成する場合：

```sh
npm run build:external
```

`dist-external/index.html` と `dist-external/data/minutes/` を同じ配信先へ配置する。全日一括取得・直接埋め込み・任意の非同期プロバイダーも引き続き使える。

ソルバは `tools/solver.cjs` にあり、全日データを作り直す操作は `npm run generate`。表示用JavaScriptにはソルバを含めていない。

## 検証

```sh
npm test
```

全86,400秒のデータを検証し、71,456件の式の厳密評価、桁の使用順、2種類の組版方針×2種類の除算表記とランダム木を含む305,824件のTeXシリアライズを確認した。

配布版そのもののブラウザテスト（CDN接続が必要）：

```sh
python tests/browser.test.py --screenshots
```

この実行環境ではCDNへ接続できなかったため、**MathJax 4.1.3＋mathjax-stix2の配布経路は未検証**。

ローカルのSTIX Twoフォントを使った互換テスト：

```sh
python tests/stix2.local.test.py \
  --local-mathjax /path/to/mathjax-full/es5 \
  --stix-fonts /path/to/stix2-otf
```

このテストではMathJax 3.2.1へ、ローカルのSTIX Two Text / Math（Version 2.12 b168）から読み取った実際の数字・通常記号の字形と寸法を一時的に設定した。数字はTextフォントの `onum` 機能から取得し、6のSVGパス一致も検査する。式の組版エンジン自体はMathJax 3であり、MathJax 4の出力と完全一致すると主張するテストではない。Euler設定の互換テストにはローカルのTeX字形を使っている。

60配置ケースで、STIX Twoの初期表示、3書体の切り替え、両除算表記、数字要素の同一性、等号の固定、通常時計表示、320/390/768px幅を確認。結果は `tests/stix2-compatibility-results.json`。スクリーンショットもこのローカル互換テストのもの。

`tests/local_stix_fixture.py` はローカルフォントを読むテスト用コードだけを含み、字形データやフォントファイルは保存・配布しない。配布する時計本体にはこの仕組みを使用していない。

## 参照

- [MathJax Font Support](https://docs.mathjax.org/en/v4.1/output/fonts.html)
- [MathJax TeX macros](https://docs.mathjax.org/en/v4.1/input/tex/macros/index.html)
- [Tiro Typeworks: STIX Two](https://www.tiro.com/fonts/stix-two)

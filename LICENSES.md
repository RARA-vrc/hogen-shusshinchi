# LICENSES

<!-- このファイルは data/licenses.yaml から scripts/build-licenses.ts が生成します。直接編集しないでください。 -->

このリポジトリに含まれるコードとデータの権利情報です。アプリ内の「クレジット」画面も同じ元データ(`data/licenses.yaml`)から生成しています。

## コード

### 本プロジェクトのソースコード

- 名称:本プロジェクトのソースコード
- 配布元URL:本リポジトリ(https://github.com/RARA-vrc/hogen-akinator)
- ライセンス:MIT(https://opensource.org/license/mit)
- クレジット表記:© 2026 RARA
- 加工内容:自作
- 取得日:—(自作)

## 自作データ

### 自作の質問データ・進行役の台詞データ(data/questions/、data/host/)

- 名称:自作の質問データ・進行役の台詞データ(data/questions/、data/host/)
- 配布元URL:本リポジトリ(https://github.com/RARA-vrc/hogen-akinator)
- ライセンス:CC BY 4.0(暫定)(https://creativecommons.org/licenses/by/4.0/deed.ja)
- クレジット表記:© 2026 RARA
- 加工内容:自作(質問文・選択肢・分布定義・台詞はすべて本プロジェクトで作成)
- 取得日:—(自作)

## 第三者のデータ

### 国土数値情報 医療圏データ(2020年度(令和2年度)版、A38-20)

- 名称:国土数値情報 医療圏データ(2020年度(令和2年度)版、A38-20)
- 配布元URL:https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A38-2020.html
- ライセンス:CC BY 4.0(配布ページの表示は「オープンデータ(CC_BY_4.0)」)(https://nlftp.mlit.go.jp/ksj/other/agreement_01.html)
- クレジット表記:出典:国土交通省国土数値情報ダウンロードサイト(https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A38-2020.html)。「国土数値情報(医療圏データ)」(国土交通省)をもとに RARA 作成
- 加工内容:一次医療圏(市区町村)ポリゴンを二次医療圏・都道府県ごとに統合し、形状を簡略化して小さな島を省略、TopoJSON に変換。市区町村と二次医療圏の対応表、二次医療圏の名称・代表点を抽出
- 取得日:2026-11-19

### 令和2年国勢調査 都道府県・市区町村別の主な結果(総務省統計局)

- 名称:令和2年国勢調査 都道府県・市区町村別の主な結果(総務省統計局)
- 配布元URL:https://www.e-stat.go.jp/stat-search/files?toukei=00200521&tstat=000001049104&tclass1=000001049105&stat_infid=000032143614
- ライセンス:政府統計の総合窓口(e-Stat)利用規約(政府標準利用規約 第2.0版準拠、CC BY 4.0 互換)(https://www.e-stat.go.jp/terms-of-use)
- クレジット表記:出典:政府統計の総合窓口(e-Stat)(https://www.e-stat.go.jp/)。「令和2年国勢調査 都道府県・市区町村別の主な結果」(総務省統計局)を加工して作成
- 加工内容:市区町村別の総人口と名称を抽出し、二次医療圏ごとに人口を合計。人口で重み付けした代表点の計算に使用
- 取得日:2026-11-19

## npm パッケージ

直接依存しているパッケージの一覧です。ライセンスは、インストールされた各パッケージの `package.json` の `license` 欄から生成時に読み取っています。

### 公開サイトに組み込まれるもの(dependencies)

(該当なし)

### 開発・ビルド時にのみ使うもの(devDependencies)

| パッケージ | バージョン | ライセンス | 配布元 |
| --- | --- | --- | --- |
| @types/node | 26.6.6 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/yauzl | 3.4.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| mapshaper | 0.8.5 | MPL-2.0 | https://github.com/mbloch/mapshaper |
| typescript | 7.0.2 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| vite | 8.3.8 | MIT | https://github.com/vitejs/vite |
| vitest | 5.1.1 | MIT | https://github.com/vitest-dev/vitest |
| yaml | 2.9.1 | ISC | https://www.npmjs.com/package/yaml |
| yauzl | 3.4.0 | MIT | https://github.com/thejoshwolfe/yauzl |

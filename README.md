# Field Info Helper - Edge拡張機能

項目定義情報のフィルタリング、DTO詳細ページへの自動遷移、テキストファイル出力を自動化する Microsoft Edge 拡張機能です。カテゴリやDTOは `config.json` で定義でき、複数 DTO をキューに積んで連続処理できます。

## ボタン実装状況（操作者向け早見表）

| ボタン | 状態 | 備考 |
| --- | --- | --- |
| 運用管理 | 未実装 | ポップアップに表示のみ、押下すると未実装メッセージ |
| 予防接種 | 未実装 | 同上 |
| 成人保健 | 未実装 | 同上 |
| 母子保健 | 実装済み | `config.json` の DTO を個別／一括実行可 |

母子保健カテゴリ内の DTO ボタンは以下のとおりです。

| ラベル | DTO名 | 状態 |
| --- | --- | --- |
| 妊娠届出情報 | `A103PregnancyDto` | 実装済み |
| 妊娠届出アンケート | `A103PregnancyQuestionnaireDto` | 実装済み |
| （母子保健 → 全部） | 上記2件を連続処理 | 実装済み |

---

## 操作ガイド（業務担当者向け）

### 1. 機能概要

- **カテゴリ／DTO選択 UI**: `config.json` に登録したカテゴリがポップアップに並び、各DTOを個別実行または「全部」ボタンで一括実行可能。
- **自動フィルタ・遷移**: DTO名で検索フィルタを設定し、結果テーブルのリンク（または直接URL）へ遷移。
- **データ抽出・出力**: form-control要素やテーブルから値を抽出し、UTF-8(BOM)付きタブ区切りテキストを自動ダウンロード。
- **エラー検知**: 「指定されたDTOを含む項目が見つかりませんでした」を検出すると自動で処理を中止し次のDTOへ移ります。

### 2. インストール手順

1. Microsoft Edge で `edge://extensions/` を開く。
2. 右上の「開発者モード」をオン。
3. 「展開して読み込み」でこのフォルダ（`EdgeExtension_field-info`）を選択。
4. ツールバーに表示される拡張機能アイコンを確認。

### 3. 基本操作

1. 対象環境の `.../core/setup/field-info` ページ（例: `https://aws-field-onpre-dev/.../core/setup/field-info`）を開く。
2. 拡張機能アイコンをクリックしてポップアップを表示。
3. カテゴリを選択し、個別DTOボタンまたは「全部」ボタンをクリック。
4. ブラウザが検索→遷移→ダウンロード→検索ページ復帰を自動で繰り返します。
5. ダウンロードフォルダに `${DTO名}.txt` が生成されていることを確認。

### 4. 自動処理の流れ
```
ポップアップでDTOを選択
    ↓
【初回のみ】キューに追加してchrome.storageに保存
    ↓
検索画面のUI準備完了を待機（テーブルデータ読み込み確認）
    ↓
DTO名でフィルタを入力し検索
  （優先順位: テーブルヘッダー内 > DTO関連 > テーブル直前 > 最初の入力欄）
    ↓
検索結果リンクをクリック（見つからない場合は直接URL遷移）
    ↓
メンバーページ読込完了を監視（最大60秒待機）
    ↓
「テキスト」ラジオを選択／検証
    ↓
form-controlやテーブルから値を抽出
    ↓
`${DTO名}.txt` をダウンロード（UTF-8 BOM付き）
    ↓
2秒待機後、「DTO選択へ」リンクをクリック
    ↓
ページ遷移→検索画面リロード
    ↓
UI準備完了を待機後、キューの次のDTOを再開
```

### 5. 出力ファイル仕様

- **ファイル名**: DTO名 + `.txt`（実際の遷移URLから決定）。
- **形式**: UTF-8 BOM 付き / タブ区切り / 各フィールドを `""` で囲む。
- **内容**: form-control の値やテーブルセルの表示値を採取。ダイアログエラー時は抽出を中止します。

### 6. トラブルシューティング

- **拡張機能が反応しない**: `core/setup/field-info` ページをアクティブにし、拡張機能が有効か確認。
- **2件目以降が始まらない**: 
  - コンソールで「検索画面UIの準備完了を確認しました」が出ているか確認。
  - 「タイムアウト: 検索画面UIが見つかりません」が出る場合、ページ読み込みが遅い可能性。
  - `chrome.storage.local` のキュー内容を確認（下記「キュー内容を確認したい」参照）。
- **フィルター入力がうまくいかない**: 
  - コンソールで「テーブルヘッダー内の入力フィールドを発見」が出ているか確認。
  - 「⚠️ 警告: 最初のテキスト入力フィールドを使用します」が出る場合、誤った入力欄を掴んでいる可能性。
- **テキストが保存されない**: コンソールログで `テキストラジオボタンが見つかりません` などのメッセージを確認し、ダウンロード制限がないかチェック。
- **キュー内容を確認したい**:
  1. DevTools コンソールを開く。
  2. 初回のみ半角で `"allow pasting"` → Enter。`Paste allowed.` 表示後、
  3. 以下を入力。
     ```js
     chrome.storage.local.get('fieldInfoHelperQueue')
       .then(result => console.log(result.fieldInfoHelperQueue));
     ```
  4. `queue` に残件があれば待機中、空なら完了です。

---

## プログラマー向け情報

### 1. システム構成とキュー制御

- **カテゴリ／DTO選択 UI**: `popup.js` が `config.json` を読み込み、カテゴリ→DTOボタンを動的生成。
- **メッセージ送信**: `sendMessageWithAutoInjection` がコンテンツスクリプト未注入時に `chrome.scripting.executeScript` で `content.js` を注入後、`filterAndNavigate` / `batchFilterAndNavigate` を送信。
- **キュー管理**: `content.js` が `fieldInfoHelperQueue`（owner: `EdgeExtension_field-info`）を `chrome.storage.local` へ保存。`initializeQueueFromStorage()` で復元後、検索画面の場合は `waitForSearchPageReady()` でUI準備完了を待ってから `processDtoQueue()` を起動。
- **検索画面UI準備待機**: `waitForSearchPageReady()` がテーブルデータ行、期待される列名（「DTO名」など）、入力欄の存在を確認（最大10秒、500ms間隔）。
- **DTOフィルター入力欄の特定**: 優先順位付き検索（①テーブルヘッダー内 → ②DTO関連の親要素 → ③テーブル直前 → ④最初の入力欄）。
- **状態フラグ**: `isProcessingDto` で同時実行を防止し、`navigateBackToSearchPage()` 完了後に `autoResume` で再度 `processDtoQueue()` を呼び出し。
- **ページ遷移処理**: メンバーページから「DTO選択へ」リンクをクリックして検索画面に戻る。ページリロード後、キューが自動的に復元・再開される。
- **ダウンロード安定化**: `DOWNLOAD_SETTLE_DELAY_MS`（2秒）待機後に検索画面へ戻し、次の DTO をキューから再開。

### 2. 設定 (config.json)

```json
{
  "categories": {
    "boshi": {
      "label": "母子保健",
      "items": [
        { "id": "pregnancy", "label": "妊娠届出情報", "dtoName": "A103PregnancyDto" },
        { "id": "PregnancyQuestionnaire", "label": "妊娠届出アンケート", "dtoName": "A103PregnancyQuestionnaireDto" }
      ]
    }
  }
}
```

- `label`: ポップアップに表示されるボタン名。
- `items`: DTOごとの `label` と `dtoName`。`dtoName` は検索フィルタ／URL遷移／ファイル名に使用。
- DTO追加後は `edge://extensions/` で拡張機能を再読み込み。

### 3. ファイル構成メモ

- `manifest.json`: Manifest V3 設定。
- `popup.html/css/js`: ポップアップ UI とカテゴリ／DTOボタン制御。
- `content.js`: キュー管理、フィルタ入力、遷移、データ抽出、ファイル出力。
- `config.json`: カテゴリと DTO の定義。
- `options.*`: 設定画面プレースホルダ（未使用）。

### 4. 開発時のヒント

- コード変更後は `edge://extensions/` から再読み込み。
- DevTools コンソールで `window.__FIELD_INFO_HELPER_CONTENT_ACTIVE__` などのログを確認すると状態把握が容易。
- `chrome.storage.local.remove('fieldInfoHelperQueue')` で手動クリア可能（開発時のみ推奨）。

## バージョン履歴

### v1.2 (最新)

- 検索画面UI準備完了待機機能を追加（テーブルデータ読み込み確認）。
- DTOフィルター入力欄の特定ロジックを改善（優先順位付き検索）。
- ページ遷移後のキュー再開処理を最適化（URL遷移ではなくリンククリックで戻る）。
- 詳細なログ出力でトラブルシューティングを容易化。

### v1.1

- カテゴリ／DTOを `config.json` から動的に生成するポップアップ UI を追加。
- `母子保健 → 全部` で複数DTOをキュー処理し、自動で検索画面へ戻って次を再開する制御を実装。
- ダウンロード後に待機しつつナビゲーションを監視することで、連続実行の安定性を改善。

### v1.0

- `A103PregnancyDto` 単体の自動検索・遷移・テキスト出力機能を実装。
- form-control 値の抽出とUTF-8テキスト出力。

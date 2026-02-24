(() => {
if (window.__FIELD_INFO_HELPER_CONTENT_ACTIVE__) {
  console.log('Field Info Helper content script is already active.');
  return;
}
window.__FIELD_INFO_HELPER_CONTENT_ACTIVE__ = true;

// メッセージリスナーを設定
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('メッセージを受信しました:', request);
  
  if (request.action === 'filterAndNavigate') {
    try {
      // シンプルに単一のDTOオブジェクトで処理
      const dtoObject = request.dtoObject;
      console.log('処理するDTO:', dtoObject);
      if (request.replaceQueue) {
        clearPendingQueue('単体リクエスト受信につきキューをクリアします。');
      }
      enqueueDto(dtoObject);
      sendResponse({ success: true });
    } catch (error) {
      console.error('処理中にエラーが発生:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  if (request.action === 'batchFilterAndNavigate') {
    try {
      const dtoObjects = Array.isArray(request.dtoObjects) ? request.dtoObjects : [];
      console.log('複数DTOの処理リクエストを受信:', dtoObjects);
      if (dtoObjects.length === 0) {
        sendResponse({ success: false, error: 'dtoObjectsが空です' });
        return;
      }
      if (request.replaceQueue) {
        clearPendingQueue('一括リクエスト受信につき待機キューをリセットします。');
      }
      dtoObjects.forEach(obj => enqueueDto(obj));
      sendResponse({ success: true });
    } catch (error) {
      console.error('複数DTO処理中にエラーが発生:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  // 同期的にレスポンスを返す（非同期処理は使用しない）
});

// 処理実行管理用のフラグとキュー
let isProcessingDto = false;
let dtoQueue = [];
const FILTER_RETRY_LIMIT = 10;
const FILTER_RETRY_DELAY_MS = 500;
const DOWNLOAD_SETTLE_DELAY_MS = 2000;

// Chrome storageでキューを保持（この拡張専用の目印付き）
const STORAGE_KEY_QUEUE = 'fieldInfoHelperQueue';
const STORAGE_OWNER = 'EdgeExtension_field-info';
let queueInitialized = false;

async function initializeQueueFromStorage() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY_QUEUE);
    const saved = data[STORAGE_KEY_QUEUE];
    if (saved && saved.owner === STORAGE_OWNER && Array.isArray(saved.queue)) {
      dtoQueue = [...saved.queue, ...dtoQueue];
      console.log('保存されていたキューを復元しました:', dtoQueue);
    } else {
      console.log('保存されたキューは見つかりませんでした。');
    }
  } catch (error) {
    console.error('キューの復元に失敗しました:', error);
  } finally {
    queueInitialized = true;
    // 検索画面の場合のみ、UIの準備完了を待ってからキュー処理を開始
    if (isOnSearchPage() && dtoQueue.length > 0) {
      console.log(`検索画面を検出。${dtoQueue.length}件のDTOが待機中です。UIの準備を待機します...`);
      waitForSearchPageReady(() => {
        console.log('検索画面の準備が完了しました。キュー処理を開始します。');
        processDtoQueue();
      });
    } else if (dtoQueue.length > 0) {
      console.log('検索画面以外でキューが存在します。300ms後に処理を試みます。');
      setTimeout(processDtoQueue, 300);
    } else {
      console.log('処理待ちのキューはありません。');
    }
  }
}

function saveQueueToStorage() {
  const payload = {
    owner: STORAGE_OWNER,
    queue: dtoQueue
  };
  chrome.storage.local.set({ [STORAGE_KEY_QUEUE]: payload }).catch(error => {
    console.error('キューの保存に失敗しました:', error);
  });
}

function clearPendingQueue(reason = 'リクエストのため待機キューをリセットします。') {
  if (dtoQueue.length > 0) {
    console.log(`${reason} (削除件数: ${dtoQueue.length})`);
  }
  dtoQueue = [];
  saveQueueToStorage();
}

function enqueueDto(dtoObject) {
  dtoQueue.push(dtoObject);
  const displayName = typeof dtoObject === 'object' ? `${dtoObject.dtoName} (${dtoObject.label})` : dtoObject;
  console.log(`DTOをキューに追加しました: ${displayName} (残り: ${dtoQueue.length})`);
  saveQueueToStorage();
  if (queueInitialized) {
    processDtoQueue();
  } else {
    console.log('キュー初期化待ちのため、少し後で処理を開始します。');
  }
}

function processDtoQueue() {
  if (!queueInitialized) {
    console.log('キューがまだ準備できていません。初期化完了を待ちます。');
    return;
  }
  if (isProcessingDto) {
    console.log('別のDTOを処理中のため、次の処理は待機します。');
    return;
  }
  const nextDto = dtoQueue.shift();
  if (!nextDto) {
    console.log('処理待ちのDTOはありません。');
    saveQueueToStorage();
    return;
  }
  isProcessingDto = true;
  console.log(`DTO処理開始:`, nextDto);
  console.log('🔍 [デバッグ] キューから取り出したDTO:', JSON.stringify(nextDto));
  saveQueueToStorage();
  filterAndNavigateToDto(nextDto);
}

function completeDtoProcessing(delayMs = 0, message = 'DTO処理完了。次のリクエストを確認します。', options = {}) {
  const { autoResume = true } = options;
  setTimeout(() => {
    isProcessingDto = false;
    saveQueueToStorage();
    console.log(message);
    if (autoResume) {
      processDtoQueue();
    } else {
      console.log('次のDTO処理はページ遷移後に再開します。');
    }
  }, delayMs);
}

function isOnSearchPage() {
  return window.location.href.includes('/core/setup/field-info') && !window.location.href.includes('/member');
}

// 検索画面のUI準備完了を待つ関数
function waitForSearchPageReady(callback) {
  let attempts = 0;
  const maxAttempts = 20; // 最大20回（10秒）
  const interval = 500; // 500ms間隔
  
  const checkReady = () => {
    attempts++;
    console.log(`検索画面UI確認 (${attempts}/${maxAttempts})`);
    
    // 1. テーブルとデータ行の存在を確認（ヘッダー行を除く）
    const tableRows = document.querySelectorAll('tbody tr, table tr');
    const hasDataRows = tableRows.length > 1; // ヘッダー + 最低1行のデータ
    
    // 2. DTOテーブルの特徴的な列（「DTO名」など）が存在するか確認
    const hasExpectedColumns = document.body.textContent.includes('DTO名') || 
                              document.body.textContent.includes('Entity名');
    
    // 3. フィルター入力欄の存在確認（複数ある場合があるので厳密にチェック）
    const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
    const hasInput = allInputs.length > 0;
    
    console.log(`  - テーブル行数: ${tableRows.length}, データ行: ${hasDataRows}`);
    console.log(`  - 期待される列: ${hasExpectedColumns}`);
    console.log(`  - 入力欄数: ${allInputs.length}`);
    
    if (hasDataRows && hasExpectedColumns && hasInput) {
      console.log('✓ 検索画面UIの準備完了を確認しました（テーブルデータ読み込み済み）');
      callback();
    } else if (attempts >= maxAttempts) {
      console.log('⚠️ タイムアウト: 検索画面UIが見つかりません。処理を続行します。');
      console.log(`  最終状態: データ行=${hasDataRows}, 列=${hasExpectedColumns}, 入力=${hasInput}`);
      callback();
    } else {
      console.log('検索画面UIがまだ準備できていません。待機を継続...');
      setTimeout(checkReady, interval);
    }
  };
  
  // 初回チェック前に少し待機（DOM構築を待つ）
  setTimeout(checkReady, 500);
}

function buildSearchPageUrl() {
  const match = window.location.href.match(/(.*\/core\/setup\/field-info)(?:\/[^\/]+\/member.*)?/);
  return match ? match[1] : null;
}

function navigateBackToSearchPage(attempt = 0) {
  const MAX_ATTEMPTS = 10;
  const RETRY_DELAY = 500;
  
  if (isOnSearchPage()) {
    console.log('既に検索画面にいるため、戻り操作は不要です。');
    return;
  }
  
  console.log(`検索画面に戻る処理を開始します (試行: ${attempt + 1}/${MAX_ATTEMPTS})`);
  
  // メンバーページからは直接URL遷移を使用（ボタン操作は不要）
  console.log('メンバーページから検索画面へURL遷移で戻ります');
  fallbackToUrlNavigation();
}

// URL遷移にフォールバックする関数
function fallbackToUrlNavigation() {
  console.log('フォールバック: URL遷移で検索画面に戻ります');
  const searchUrl = buildSearchPageUrl();
  if (!searchUrl) {
    console.error('検索画面URLを特定できませんでした。');
    alert('検索画面に戻ることができませんでした。ページ構造を確認してください。');
    return;
  }
  console.log('検索画面に戻ります:', searchUrl);
  if (window.location.href !== searchUrl) {
    window.location.href = searchUrl;
  }
}

// DTOフィルタを設定して結果ページに遷移する関数
function filterAndNavigateToDto(dtoObject, attempt = 0) {
  const dtoName = dtoObject.dtoName;
  const label = dtoObject.label || dtoName;
  console.log('🔍 [デバッグ] filterAndNavigateToDto受信:', JSON.stringify(dtoObject));
  console.log('🔍 [デバッグ] 抽出したdtoName:', dtoName, 'label:', label);
  try {
    if (!isOnSearchPage()) {
      console.log('検索画面ではないため、処理を一時停止して検索画面に戻ります。');
      dtoQueue.unshift(dtoObject);
      saveQueueToStorage();
      completeDtoProcessing(0, '検索画面で処理を再開します。', { autoResume: false });
      setTimeout(() => navigateBackToSearchPage(), 300);
      return;
    }
    console.log(`DTO処理開始: ${dtoName}`);
    
    // DTOフィルタの入力フィールドを探す
    const filterInput = findFilterInput();
    
    if (filterInput) {
      // フィルタを設定
      filterInput.value = dtoName;
      console.log('フィルタに入力しました:', dtoName);
      
      // 入力イベントを発火（検索を実行）
      const inputEvent = new Event('input', { bubbles: true });
      filterInput.dispatchEvent(inputEvent);
      console.log('入力イベントを発火しました');
      
      // 少し待ってから結果のリンクを探してクリック
      setTimeout(() => {
        console.log('結果を確認中...');
        const success = clickResultLink(dtoName, label);
        
        if (!success) {
          console.log('結果が見つかりませんでした');
          alert(`指定されたDTO名での結果が見つかりませんでした: ${dtoName}`);
          completeDtoProcessing();
        }
      }, 1000);
    } else {
      if (attempt < FILTER_RETRY_LIMIT) {
        console.log(`DTOフィルタの入力フィールドがまだ見つかりません。再試行します (${attempt + 1}/${FILTER_RETRY_LIMIT})`);
        setTimeout(() => filterAndNavigateToDto(dtoObject, attempt + 1), FILTER_RETRY_DELAY_MS);
        return;
      }
      console.error('DTOフィルタの入力フィールドが見つかりません');
      alert('DTOフィルタの入力フィールドが見つかりません。ページの構造を確認してください。');
      completeDtoProcessing();
    }
  } catch (error) {
    console.error('フィルタ設定中にエラーが発生しました:', error);
    alert('処理中にエラーが発生しました: ' + error.message);
    completeDtoProcessing();
  }
}

// DTOフィルタの入力フィールドを探す関数
function findFilterInput() {
  console.log('DTOフィルタ入力フィールドを検索中...');
  
  // 一般的なフィルタ入力フィールドのセレクタを試す
  const selectors = [
    'input[placeholder*="DTO"]',
    'input[placeholder*="フィルタ"]',
    'input[placeholder*="filter"]',
    'input[name*="dto"]',
    'input[name*="filter"]',
    'input[id*="dto"]',
    'input[id*="filter"]',
    'input[class*="filter"]',
    'input[class*="search"]'
  ];
  
  for (const selector of selectors) {
    const input = document.querySelector(selector);
    if (input) {
      console.log('フィルタ入力フィールドを発見:', selector, input);
      return input;
    }
  }
  
  // より具体的な検索: テーブルヘッダーや近くのテキストから推測
  const possibleInputs = document.querySelectorAll('input[type="text"], input:not([type])');
  console.log('候補となる入力フィールド数:', possibleInputs.length);
  
  // 優先順位1: テーブルヘッダー内の入力欄（最も確実）
  const tableHeaders = document.querySelectorAll('th, thead');
  for (const header of tableHeaders) {
    const inputInHeader = header.querySelector('input[type="text"], input:not([type])');
    if (inputInHeader) {
      console.log('テーブルヘッダー内の入力フィールドを発見（最優先）:', inputInHeader);
      return inputInHeader;
    }
  }
  
  // 優先順位2: DTO/フィルタに関連する親要素を持つ入力欄
  for (const input of possibleInputs) {
    const parent = input.closest('th, td, div, span, label');
    if (parent) {
      const parentText = parent.textContent.toLowerCase();
      if (parentText.includes('dto') || parentText.includes('フィルタ') || parentText.includes('filter')) {
        console.log('DTOに関連する入力フィールドを発見:', input);
        return input;
      }
    }
  }
  
  // 優先順位3: テーブルの直前にある入力欄
  const tables = document.querySelectorAll('table');
  if (tables.length > 0) {
    const firstTable = tables[0];
    let currentElement = firstTable.previousElementSibling;
    while (currentElement) {
      const inputNearTable = currentElement.querySelector('input[type="text"], input:not([type])');
      if (inputNearTable) {
        console.log('テーブル直前の入力フィールドを発見:', inputNearTable);
        return inputNearTable;
      }
      currentElement = currentElement.previousElementSibling;
      if (!currentElement || currentElement.tagName === 'TABLE') break;
    }
  }
  
  // 最後の手段：最初のテキスト入力フィールドを使用（リスクあり）
  if (possibleInputs.length > 0) {
    console.log('⚠️ 警告: 最初のテキスト入力フィールドを使用します:', possibleInputs[0]);
    return possibleInputs[0];
  }
  
  console.error('DTOフィルタ入力フィールドが見つかりません');
  return null;
}

// 結果のリンクをクリックする関数
function clickResultLink(dtoName, label) {
  console.log('🔍 [デバッグ] clickResultLink受信 - dtoName:', dtoName, 'label:', label);
  try {
    console.log(`結果リンクを検索中: ${dtoName} (${label})`);
    
    // まず、テーブル内の結果を確認
    const tableRows = document.querySelectorAll('tr');
    let foundInTable = false;
    let targetLink = null;
    
    console.log('テーブル行数:', tableRows.length);
    
    for (let i = 0; i < tableRows.length; i++) {
      const row = tableRows[i];
      const rowText = row.textContent;
      console.log(`行${i}: ${rowText.substring(0, 100)}...`);
      
      if (rowText.includes(dtoName)) {
        console.log('テーブル内に結果を発見:', dtoName, 'in row', i);
        foundInTable = true;
        
        // 行内のリンクを探す
        const linkInRow = row.querySelector('a');
        if (linkInRow) {
          targetLink = linkInRow;
          console.log('行内のリンクを発見:', linkInRow.href);
          break;
        } else {
          console.log('行内にリンクが見つかりません');
        }
      }
    }
    
    // 行内にリンクが見つからない場合、全体からDTO名を含むリンクを探す
    if (!targetLink && foundInTable) {
      const allLinks = document.querySelectorAll('a');
      for (const link of allLinks) {
        if (link.textContent.includes(dtoName) || link.href.includes(dtoName)) {
          targetLink = link;
          console.log('全体からリンクを発見:', link.href);
          break;
        }
      }
    }
    
    if (targetLink) {
      console.log('対象のリンクをクリック:', targetLink.href);
      targetLink.click();
      schedulePostNavigationTasks(dtoName, label);
      return true;
    } else if (foundInTable) {
      // テーブル内に結果があるが、リンクが見つからない場合は直接遷移
      const currentOrigin = window.location.origin;
      const targetUrl = `${currentOrigin}/core/setup/field-info/${dtoName}/member`;
      console.log('テーブル内に結果があるため、直接遷移:', targetUrl);
      window.location.href = targetUrl;
      schedulePostNavigationTasks(dtoName, label);
      return true;
    } else {
      console.log(`${dtoName} の結果が見つかりません`);
      completeDtoProcessing(0, '結果が見つからなかったため処理を終了します。');
      return false;
    }
  } catch (error) {
    console.error('リンククリック中にエラーが発生しました:', error);
    // エラーが発生した場合も直接遷移を試行
    const currentOrigin = window.location.origin;
    const targetUrl = `${currentOrigin}/core/setup/field-info/${dtoName}/member`;
    console.log('エラーのため直接遷移を試行:', targetUrl);
    window.location.href = targetUrl;
    schedulePostNavigationTasks(dtoName);
    
    return true;
  }
}

function schedulePostNavigationTasks(dtoName, label) {
  console.log('🔍 [デバッグ] schedulePostNavigationTasks受信 - dtoName:', dtoName, 'label:', label);
  // メンバーページに遷移後、十分な時間を待ってからテキスト出力を実行
  setTimeout(() => {
    if (window.location.href.includes(`/core/setup/field-info/${dtoName}/member`)) {
      console.log('メンバーページに遷移しました。さらに待機してからテキスト出力を実行します。');
      waitForPageAndDataLoad(() => {
        exportToTextFile(dtoName, label, {
          onSuccess: () => {
            setTimeout(() => {
              completeDtoProcessing(0, '✓ DTO処理完了。検索画面に戻ります。', { autoResume: false });
              navigateBackToSearchPage();
            }, DOWNLOAD_SETTLE_DELAY_MS);
          },
          onError: () => {
            setTimeout(() => {
              completeDtoProcessing(0, 'エラー後に検索画面へ戻ります。', { autoResume: false });
              navigateBackToSearchPage();
            }, DOWNLOAD_SETTLE_DELAY_MS);
          }
        });
      });
    } else {
      // 遷移に失敗した場合もフラグをリセット
      completeDtoProcessing(0, '遷移に失敗しました。次を処理します。');
    }
  }, 3000); // 3秒待機
}

// ページが完全に読み込まれた後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

function initialize() {
  console.log('Field Info Helper コンテンツスクリプトが読み込まれました');
  console.log('現在のURL:', window.location.href);
  console.log('ページタイトル:', document.title);
  console.log('DOM読み込み状態:', document.readyState);
  initializeQueueFromStorage();
  
  // メンバーページのデバッグ情報表示
  if (window.location.href.includes('/member')) {
    console.log('=== メンバーページ情報 ===');
    const urlParts = window.location.href.split('/');
    const memberIndex = urlParts.indexOf('member');
    if (memberIndex > 0) {
      const currentDto = urlParts[memberIndex - 1];
      console.log('DTO名:', currentDto);
    }
    
    // ページ読み込み後に要素情報を表示
    setTimeout(() => {
      console.log('DOM要素数:', document.querySelectorAll('*').length);
      console.log('テーブル数:', document.querySelectorAll('table').length);
      console.log('ラジオボタン数:', document.querySelectorAll('input[type="radio"]').length);
      console.log('=======================');
    }, 4000);
  }
}

// ページとデータの読み込み完了を待つ関数
function waitForPageAndDataLoad(callback) {
  console.log('ページとデータの読み込み完了を待機中...');
  
  let attempts = 0;
  const maxAttempts = 60; // 最大60回試行（30秒）に延長
  
  const checkInterval = setInterval(() => {
    attempts++;
    console.log(`読み込み確認試行 ${attempts}/${maxAttempts}`);
    
    // ページ全体のテキストでエラーメッセージを検出
    const fullPageText = document.body.textContent || document.body.innerText || '';
    const hasError = fullPageText.includes('指定されたDTOを含む') && fullPageText.includes('見つかりませんでした');
    
    if (hasError) {
      console.log('❌ エラーメッセージを検出しました');
      console.log('DTOに対応するデータが存在しません。処理を中止します。');
      clearInterval(checkInterval);
      
      // エラーダイアログを閉じる
      const okButton = document.querySelector('button') || 
                      document.querySelector('input[type="button"]') ||
                      document.querySelector('[onclick]');
      
      if (okButton) {
        console.log('ダイアログを閉じます');
        setTimeout(() => okButton.click(), 500);
      }
      
      completeDtoProcessing(1000, 'データ読み込みエラーのため処理を中止しました。');
      return;
    }
    
    // グリッドまたはテーブルが存在するかチェック
    const gridElement = document.querySelector('table, .grid, .data-grid, tbody tr');
    const hasData = gridElement && (
      gridElement.children.length > 0 || 
      document.querySelectorAll('tbody tr').length > 1 || // ヘッダー以外の行があるか
      document.querySelector('td, .grid-cell')
    );
    
    if (hasData) {
      console.log('データが読み込まれました。さらに1秒待機してから処理を開始します。');
      clearInterval(checkInterval);
      setTimeout(callback, 1000); // 3秒後に実行（延長）
    } else if (attempts >= maxAttempts) {
      console.log('タイムアウト: データの読み込みを待機しましたが、データが見つかりませんでした。');
      clearInterval(checkInterval);
      // タイムアウト後も少し待ってから実行
      setTimeout(callback, 2000);
    } else {
      console.log('データがまだ読み込まれていません。待機を継続...');
    }
  }, 1000); // 1秒間隔でチェック（間隔も延長）
}

// テキストファイル出力機能
function exportToTextFile(dtoName, label, options = {}) {
  console.log('🔍 [デバッグ] exportToTextFile受信 - dtoName:', dtoName, 'label:', label);
  const { onSuccess, onError } = options;
  const notifySuccess = () => {
    if (onSuccess) {
      onSuccess();
    }
  };
  const notifyError = () => {
    if (onError) {
      onError();
    }
  };
  console.log(`=== テキストファイル出力開始 ===`);
  console.log(`DTO名: ${dtoName}`);
  console.log(`ラベル: ${label}`);
  console.log(`現在のURL: ${window.location.href}`);
  console.log(`ページ読み込み状態: ${document.readyState}`);
  
  try {
    // ページ全体でエラーメッセージを確認
    const pageText = document.body.textContent || document.body.innerText || '';
    const hasError = pageText.includes('指定されたDTOを含む') && pageText.includes('見つかりませんでした');
    
    if (hasError) {
      console.log('❌ exportToTextFile: エラーメッセージを検出しました');
      console.log('処理を中止し、ダイアログを閉じます');
      
      // 任意のボタンをクリックしてダイアログを閉じる
      const closeButton = document.querySelector('button') || 
                         document.querySelector('input[type="button"]');
      
      if (closeButton) {
        console.log('ダイアログを閉じます');
        closeButton.click();
      }
      
      console.log('=== 処理完了（エラーのため中止）===');
      
      // エラー時もフラグをリセット
      notifyError();
      
      return; // エラーの場合は処理を終了
    }
    
    console.log('✓ エラーチェック完了。処理を継続します。');
    
    // データの存在確認
    const hasData = document.querySelector('tbody tr:not(:first-child)') || 
                   document.querySelector('table td') ||
                   document.querySelector('.grid-cell');
    
    if (!hasData) {
      console.log('警告: グリッドにデータが表示されていません。それでも処理を続行します。');
    }
    
    // より具体的にテキストラジオボタンを探す
    let textRadio = null;
    
    // 複数の方法でテキストラジオボタンを検索
    const radioSelectors = [
      'input[type="radio"][value="text"]',
      'input[type="radio"][id*="text"]', 
      'input[type="radio"][name*="text"]',
      'input[type="radio"][class*="text"]'
    ];
    
    for (let selector of radioSelectors) {
      textRadio = document.querySelector(selector);
      if (textRadio) break;
    }
    
    // ラベルからも検索
    if (!textRadio) {
      console.log('ラベルからテキストラジオボタンを検索中...');
      const labels = document.querySelectorAll('label');
      console.log(`ラベル数: ${labels.length}`);
      
      for (let label of labels) {
        const labelText = label.textContent || label.innerText || '';
        if (labelText.includes('テキスト')) {
          console.log(`テキストラベルを発見: "${labelText}"`);
          textRadio = label.querySelector('input[type="radio"]');
          
          if (!textRadio && label.getAttribute('for')) {
            const forId = label.getAttribute('for');
            textRadio = document.getElementById(forId);
            console.log(`for属性でラジオボタンを検索: ${forId}`);
          }
          
          if (textRadio) {
            console.log('ラベルから関連ラジオボタンを発見');
            break;
          }
        }
      }
    }
    
    // それでも見つからない場合は、全てのラジオボタンをチェック
    if (!textRadio) {
      const allRadios = document.querySelectorAll('input[type="radio"]');
      console.log('利用可能なラジオボタン:', allRadios.length);
      
      for (let radio of allRadios) {
        console.log('ラジオボタン詳細:', {
          id: radio.id,
          name: radio.name,
          value: radio.value,
          className: radio.className
        });
        
        // 「テキスト」に関連するラジオボタンを探す
        if (radio.value === 'text' || radio.id.includes('text') || radio.name.includes('text')) {
          textRadio = radio;
          break;
        }
      }
      
      // 最後の手段として2番目のラジオボタン（通常テキストボタン）を選択
      if (!textRadio && allRadios.length >= 2) {
        textRadio = allRadios[1]; // 0=グリッド, 1=テキスト の想定
        console.log('フォールバック: 2番目のラジオボタンを選択');
      }
    }
    
    if (textRadio) {
      console.log('テキストラジオボタンを発見:', {
        id: textRadio.id,
        name: textRadio.name,
        value: textRadio.value,
        checked: textRadio.checked
      });
      
      // 確実に選択する
      textRadio.checked = true;
      textRadio.click();
      
      // 複数のイベントを発火
      ['change', 'click', 'input', 'focus'].forEach(eventType => {
        const event = new Event(eventType, { bubbles: true, cancelable: true });
        textRadio.dispatchEvent(event);
      });
      
      console.log('✓ テキストラジオボタンを選択しました');
      
      // 選択状態を確認
      setTimeout(() => {
        console.log('選択状態確認:', textRadio.checked);
      }, 500);
      
    } else {
      console.log('❌ テキストラジオボタンが見つかりません');
      // 手動でテキストファイルを作成
      console.log('手動でテキストファイルを作成します');
      extractAndDownloadData(dtoName, label);
      setTimeout(notifySuccess, 1000);
      return;
    }
    
    // 十分な時間を待ってから直接データを抽出してテキストファイルを作成
    setTimeout(() => {
      console.log('=== データ抽出段階に移行 ===');
      console.log('拡張機能によるデータ抽出を開始します...');
      console.log('注意: 該当ページには出力ボタンが存在しないため、拡張機能で直接データを抽出します。');
      
      try {
        // 拡張機能による直接データ抽出
        extractAndDownloadData(dtoName, label);
        setTimeout(notifySuccess, 1000);
      } catch (extractError) {
        console.error('データ抽出中にエラーが発生しました:', extractError);
        notifyError();
      }
    }, 1000); // 1秒待機に短縮
    
  } catch (error) {
    console.error('テキストファイル出力エラー:', error);
  }
}

// グリッドデータを抽出してテキストファイルをダウンロードする関数
function extractAndDownloadData(dtoName, label) {
  console.log('=== グリッドデータ抽出開始 ===');
  console.log(`DTO名: ${dtoName}`);
  console.log(`ラベル: ${label}`);
  console.log('🔍 [デバッグ] extractAndDownloadData受信 - dtoName:', dtoName, 'label:', label);
  console.log('🔍 [デバッグ] 生成されるファイル名:', `${dtoName}_${label}.txt`);
  console.log('エラー回避のため、標準CSSセレクタのみを使用します');
  
  try {
    // まずform-controlクラスの要素からデータを抽出
    const formControlData = extractFormControlData();
    
    // 複数の方法でテーブルまたはグリッドを探す
    let table = document.querySelector('table') ||
               document.querySelector('.grid') ||
               document.querySelector('.data-grid') ||
               document.querySelector('[class*="grid"]') ||
               document.querySelector('div[data-v-77165fa8]') || // Vue.jsコンポーネント（具体的な属性）
               document.querySelector('div[data-v-55a1e047]');
    
    // より具体的にグリッド要素を探す
    if (!table) {
      // 安全なセレクタのみ使用
      const possibleGrids = document.querySelectorAll('div[data-v-77165fa8], div[data-v-55a1e047], .ax-text-box, .ax-stack, .grid-container, .vue-grid');
      for (let grid of possibleGrids) {
        if (grid.textContent && (grid.textContent.includes('項目名') || grid.textContent.includes('分類名称'))) {
          table = grid;
          console.log('候補グリッドを発見:', grid);
          break;
        }
      }
    }
    
    if (!table) {
      console.log('テーブルまたはグリッドが見つかりません。フォームデータとページ全体を抽出します。');
      // フォームデータと全体からテキストを抽出
      extractFromFullPageWithFormData(dtoName, formControlData);
      return;
    }
    
    console.log('テーブルを発見:', table);
    
    // データを抽出
    const rows = table.querySelectorAll('tr');
    const data = [];
    
    console.log(`テーブル行数: ${rows.length}`);
    console.log('添付ファイル形式に合わせた出力を行います');
    
    // 全ての行を処理（ヘッダー/データ区別なし）
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.querySelectorAll('td, th');
      const rowData = [];
      
      console.log(`行 ${i + 1}: セル数 ${cells.length}`);
      
      cells.forEach((cell, cellIndex) => {
        let text = (cell.textContent || cell.innerText || '').trim();
        let hasFormData = false;
        
        // セル内のform-control要素をチェック
        const formControlInCell = cell.querySelector('.form-control');
        if (formControlInCell) {
          const formValue = formControlInCell.value || formControlInCell.textContent || '';
          if (formValue.trim()) {
            text = formValue.trim(); // form-controlの値を優先
            hasFormData = true;
          }
        }
        
        // セル内の全てのinput要素をチェック
        const inputsInCell = cell.querySelectorAll('input');
        inputsInCell.forEach(input => {
          if (input.value && input.value.trim()) {
            text = input.value.trim();
            hasFormData = true;
          }
        });
        
        // セル内のselect要素もチェック
        const selectInCell = cell.querySelector('select');
        if (selectInCell) {
          const selectedOption = selectInCell.selectedOptions[0];
          if (selectedOption && selectedOption.text.trim()) {
            text = selectedOption.text.trim();
            hasFormData = true;
          }
        }
        
        // セル内のtextarea要素もチェック  
        const textareaInCell = cell.querySelector('textarea');
        if (textareaInCell && textareaInCell.value.trim()) {
          text = textareaInCell.value.trim();
          hasFormData = true;
        }
        
        // CSVライクな形式のため、各フィールドを""で囲む
        const formattedText = `"${text}"`;
        rowData.push(formattedText);
        
        // デバッグ: 最初の数個のセルの内容を確認
        if (i < 3 && cellIndex < 10) {
          console.log(`  セル[${i},${cellIndex}]: ${formattedText} ${hasFormData ? '(フォームデータ)' : '(テキスト)'}`);
        }
      });
      
      // 空行でもデータに含める（フォーマット保持のため）
      if (rowData.length > 0) {
        data.push(rowData.join('\t')); // タブ区切り、各フィールドは""で囲まれている
      }
    }
    
    console.log(`抽出したテーブルデータ行数: ${data.length}`);
    
    // form-controlデータは統合せず、テーブルデータのみを出力
    // （添付ファイルの形式に合わせてテーブルデータのみ出力）
    console.log('テーブルデータのみを出力します(添付ファイル形式に準拠)');
    
    if (data.length === 0 || (data.length === 1 && data[0] === '')) {
      console.log('抽出できるテーブルデータがありません。全体からデータを収集します。');
      extractFromFullPageWithFormData(dtoName, label, formControlData);
      return;
    }
    
    console.log('添付ファイル形式でのデータ出力を準備中...');
    
    // テキストファイルを作成してダウンロード（UTF-8 BOM付き）
    const textContent = data.join('\n');
    const utf8BOM = '\uFEFF'; // UTF-8 BOM (Byte Order Mark)
    const finalContent = utf8BOM + textContent;
    const blob = new Blob([finalContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const fileName = `${dtoName}_${label}.txt`;
    
    // ダウンロード設定を取得してダウンロード
    chrome.storage.sync.get('downloadFolder', (result) => {
      const downloadFolder = result.downloadFolder || '';
      const filePath = downloadFolder ? `${downloadFolder}${fileName}` : fileName;
      
      chrome.downloads.download({
        url: url,
        filename: filePath,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('ダウンロードエラー:', chrome.runtime.lastError);
        } else {
          console.log(`ダウンロード開始 (ID: ${downloadId}): ${filePath}`);
        }
        // クリーンアップ
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
      });
    });
    
    console.log(`テキストファイル "${fileName}" をダウンロードしました`);
    console.log('抽出したform-controlデータ数:', formControlData ? formControlData.length : 0);
    console.log('ファイル内容プレビュー:', textContent.substring(0, 300) + '...');
    
  } catch (error) {
    console.error('データ抽出エラー:', error);
  }
}

// form-controlクラスの要素からデータを抽出する関数
function extractFormControlData() {
  console.log('form-controlクラスの要素からデータを抽出中...');
  
  const formControlElements = document.querySelectorAll('.form-control');
  const formData = [];
  
  console.log(`form-control要素数: ${formControlElements.length}`);
  
  formControlElements.forEach((element, index) => {
    const tagName = element.tagName.toLowerCase();
    let value = '';
    let label = '';
    
    // 要素の種類に応じて値を取得
    if (tagName === 'input') {
      value = element.value || element.placeholder || '';
    } else if (tagName === 'select') {
      const selectedOption = element.selectedOptions[0];
      value = selectedOption ? selectedOption.text : '';
    } else if (tagName === 'textarea') {
      value = element.value || '';
    } else {
      value = element.textContent || element.innerText || '';
    }
    
    // ラベルを探す
    const id = element.id;
    if (id) {
      const labelElement = document.querySelector(`label[for="${id}"]`);
      if (labelElement) {
        label = labelElement.textContent || labelElement.innerText || '';
      }
    }
    
    // 親要素からラベルを探す
    if (!label) {
      const parent = element.closest('.form-group, .field, .row, .col, [class*="form"]');
      if (parent) {
        const labelInParent = parent.querySelector('label');
        if (labelInParent) {
          label = labelInParent.textContent || labelInParent.innerText || '';
        }
      }
    }
    
    // 近隣のテキストからラベルを推測
    if (!label) {
      const previousSibling = element.previousElementSibling;
      if (previousSibling && previousSibling.textContent) {
        label = previousSibling.textContent.trim();
      }
    }
    
    if (value.trim() !== '') {
      formData.push({
        index: index,
        label: label.trim() || `フィールド${index + 1}`,
        value: value.trim(),
        tagName: tagName,
        id: element.id,
        className: element.className
      });
      
      console.log(`form-control[${index}]: ${label} = "${value}"`);
    }
  });
  
  return formData;
}

// フォームデータを含むページ全体からデータを抽出する関数
function extractFromFullPageWithFormData(dtoName, label, formControlData) {
  console.log('フォームデータを含むページ全体からデータを抽出します...');
  console.log('🔍 [デバッグ] extractFromFullPageWithFormData受信 - dtoName:', dtoName, 'label:', label);
  
  try {
    const allData = [];
    
    // URLからDTO名を取得
    const currentUrl = window.location.href;
    const dtoMatch = currentUrl.match(/field-info\/([^\/]+)\/member/);
    const actualDtoName = dtoMatch ? dtoMatch[1] : dtoName;
    
    // form-controlデータがある場合は直接追加（ヘッダー情報なし）
    if (formControlData && formControlData.length > 0) {
      formControlData.forEach((item, index) => {
        // 最初の項目（フィールド1:）はスキップ
        if (index === 0 && item.value.startsWith('"分類名称"')) {
          // ヘッダー行をそのまま追加
          allData.push(item.value);
        } else if (index > 0) {
          // データ行を追加
          allData.push(item.value);
        }
      });
    }
    
    // テーブルデータ処理は不要（form-controlデータのみ使用）
    
    // 不要なセクションは削除（ユーザーの要求に従い）
    
    // テキストファイルを作成してダウンロード（UTF-8 BOM付き）
    const textContent = allData.join('\n');
    const utf8BOM = '\uFEFF'; // UTF-8 BOM (Byte Order Mark)
    const finalContent = utf8BOM + textContent;
    const blob = new Blob([finalContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // ダウンロードリンクを作成
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    const fileName = `${actualDtoName}_${label}.txt`;
    downloadLink.download = fileName;
    downloadLink.style.display = 'none';
    
    // ページに追加してクリック
    document.body.appendChild(downloadLink);
    downloadLink.click();
    
    // クリーンアップ
    setTimeout(() => {
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(url);
    }, 1000);
    
    console.log(`テキストファイル "${fileName}" をダウンロードしました`);
    console.log('抽出したform-controlデータ数:', formControlData ? formControlData.length : 0);
    console.log('ファイル内容プレビュー:', textContent.substring(0, 300) + '...');
    
  } catch (error) {
    console.error('フォームデータ含む抽出エラー:', error);
  }
}

})();


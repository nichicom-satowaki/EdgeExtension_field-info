// グローバル変数として設定を保持
// 「config」はボタンの名前やDTOを覚えておくメモ帳です
let config = null;
// 「sleep」は少し待つためのおまじない関数です
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup DOMContentLoaded イベント発火');
  loadConfigAndInitialize();
  
  // 設定ボタンのイベントリスナー
  const settingsButton = document.getElementById('settings-button');
  if (settingsButton) {
    settingsButton.addEventListener('click', function() {
      chrome.runtime.openOptionsPage();
    });
  }
});

// 設定を読み込んで初期化
async function loadConfigAndInitialize() {
  try {
    // config.jsonを読み込む
    const response = await fetch(chrome.runtime.getURL('config.json'));
    config = await response.json();
    console.log('設定を読み込みました:', config);
    
    // カテゴリボタンを表示
    displayCategories();
    
    // 設定状態を更新
    const configStatus = document.getElementById('config-status');
    if (configStatus) {
      configStatus.textContent = '準備完了';
    }
  } catch (error) {
    console.error('設定の読み込みに失敗:', error);
    const configStatus = document.getElementById('config-status');
    if (configStatus) {
      configStatus.textContent = '設定の読み込みに失敗しました';
    }
  }
}

// カテゴリボタンを表示
function displayCategories() {
  const container = document.getElementById('category-buttons');
  if (!container || !config || !config.categories) {
    console.error('カテゴリコンテナまたは設定が見つかりません');
    return;
  }
  
  // 登録されているカテゴリの数だけボタンを作ります
  // カテゴリごとにボタンを作成
  Object.keys(config.categories).forEach(categoryKey => {
    const category = config.categories[categoryKey];
    const button = document.createElement('button');
    button.className = 'btn';
    button.id = `btn-${categoryKey}`;
    button.textContent = category.label;
    
    // ボタンのクリックイベント
    button.addEventListener('click', () => {
      handleCategoryClick(categoryKey, category);
    });
    
    container.appendChild(button);
  });
  
  console.log('カテゴリボタンを表示しました');
}

// カテゴリがクリックされたときの処理
function handleCategoryClick(categoryKey, category) {
  console.log(`${category.label}がクリックされました`);
  
  // サブアイテムがない場合
  if (!category.items || category.items.length === 0) {
    alert(`${category.label}機能は未実装です。`);
    return;
  }
  
  // サブアイテムを表示（1件でも一覧を介して選ばせる）
  displaySubItems(category);
}

// サブアイテムを表示
function displaySubItems(category) {
  // カテゴリボタンを非表示
  document.getElementById('category-buttons').style.display = 'none';
  
  // サブアイテムエリアを表示
  const subItemsContainer = document.getElementById('sub-items-container');
  const subItemsTitle = document.getElementById('sub-items-title');
  const subItemsList = document.getElementById('sub-items-list');
  
  subItemsTitle.textContent = category.label;
  subItemsList.innerHTML = ''; // クリア
  
  // 「全部」ボタンで一気に処理できます
  // まとめて実行ボタン
  if (category.items.length > 1) {
    const allButton = document.createElement('button');
    allButton.className = 'sub-item-btn all-btn';
    allButton.textContent = '全部';
    allButton.addEventListener('click', () => {
      executeBatch(category.items.map(item => ({ dtoName: item.dtoName, label: item.label })));
    });
    subItemsList.appendChild(allButton);
  }
  
  // サブアイテム1つずつ実行する通常ボタンです
  // 各サブアイテムのボタンを作成
  category.items.forEach(item => {
    const button = document.createElement('button');
    button.className = 'sub-item-btn';
    button.textContent = item.label;
    
    button.addEventListener('click', () => {
      executeSearch({ dtoName: item.dtoName, label: item.label });
    });
    
    subItemsList.appendChild(button);
  });
  
  subItemsContainer.style.display = 'block';
  
  // 戻るボタンのイベント
  document.getElementById('back-button').onclick = () => {
    subItemsContainer.style.display = 'none';
    document.getElementById('category-buttons').style.display = 'flex';
  };
}

// 複数DTOを連続実行
async function executeBatch(dtoObjects) {
  try {
    // まず現在のfield-infoタブを取得します
    const tab = await getActiveFieldInfoTab();
    if (!tab) {
      alert('field-infoページが開かれていません。');
      return;
    }

    await sendMessageWithAutoInjection(tab.id, {
      action: 'batchFilterAndNavigate',
      dtoObjects: dtoObjects,
      replaceQueue: true
    });

    window.close();
  } catch (error) {
    console.error('一括実行でエラーが発生しました:', error);
    alert('一括実行でエラーが発生しました: ' + error.message);
  }
}

// DTO検索を実行
async function executeSearch(dtoObject, options = {}) {
  const { closeAfter = true } = options;
  try {
    console.log('検索を実行:', dtoObject);
    
    // アクティブなタブを取得
    const tab = await getActiveFieldInfoTab();
    if (!tab) {
      alert('field-infoページでこの機能を使用してください。');
      return;
    }
    
    await sendMessageWithAutoInjection(tab.id, {
      action: 'filterAndNavigate',
      dtoObject: dtoObject,
      replaceQueue: true
    });

    // 最後の処理ならポップアップを閉じます
    if (closeAfter) {
      window.close();
    }

  } catch (error) {
    console.error('検索実行エラー:', error);
    alert('エラーが発生しました: ' + error.message);
    throw error;
  }
}

async function getActiveFieldInfoTab() {
  // 現在開いているタブがfield-infoかどうかを確認
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.includes('/core/setup/field-info')) {
    return null;
  }
  return tab;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
}

async function sendMessageWithAutoInjection(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const messageText = error && error.message ? error.message : '';
    const needsInjection = messageText.includes('Receiving end does not exist');
    if (!needsInjection) {
      throw error;
    }
    console.log('コンテンツスクリプト未読込のため注入します:', messageText);
    await ensureContentScript(tabId);
    await sleep(100);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

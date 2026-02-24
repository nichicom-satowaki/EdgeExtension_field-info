// ページが読み込まれたときの初期化
document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  loadDownloadSettings();
  
  // 保存ボタンのイベントリスナー
  document.getElementById('save-button').addEventListener('click', saveDownloadSettings);
});

// 設定を読み込んで表示
async function loadSettings() {
  try {
    // config.jsonを読み込む
    const response = await fetch(chrome.runtime.getURL('config.json'));
    const config = await response.json();
    
    console.log('現在の設定を読み込みました:', config);
    
    // 設定を表示
    displaySettings(config);
    
  } catch (error) {
    console.error('設定の読み込みに失敗しました:', error);
    document.getElementById('categories-container').innerHTML = 
      '<p style="color: red;">設定の読み込みに失敗しました。</p>';
  }
}

// 設定を階層表示
function displaySettings(config) {
  const container = document.getElementById('categories-container');
  
  if (!config || !config.categories) {
    container.innerHTML = '<p>設定が見つかりません。</p>';
    return;
  }
  
  container.innerHTML = ''; // クリア
  
  // 各カテゴリを表示
  Object.keys(config.categories).forEach(categoryKey => {
    const category = config.categories[categoryKey];
    
    // カテゴリグループを作成
    const categoryGroup = document.createElement('div');
    categoryGroup.className = 'category-group';
    
    // カテゴリ名
    const categoryTitle = document.createElement('h3');
    categoryTitle.textContent = category.label;
    categoryGroup.appendChild(categoryTitle);
    
    // サブアイテムがある場合
    if (category.items && category.items.length > 0) {
      category.items.forEach(item => {
        const subItem = document.createElement('div');
        subItem.className = 'sub-item';
        
        const label = document.createElement('div');
        label.className = 'sub-item-label';
        label.textContent = item.label;
        
        const dto = document.createElement('div');
        dto.className = 'sub-item-dto';
        dto.textContent = `DTO: ${item.dtoName}`;
        
        subItem.appendChild(label);
        subItem.appendChild(dto);
        categoryGroup.appendChild(subItem);
      });
    } else {
      // サブアイテムがない場合
      const noItems = document.createElement('div');
      noItems.className = 'no-items';
      noItems.textContent = '項目未設定';
      categoryGroup.appendChild(noItems);
    }
    
    container.appendChild(categoryGroup);
  });
}

// ダウンロード設定を読み込む
async function loadDownloadSettings() {
  try {
    const result = await chrome.storage.sync.get('downloadFolder');
    const downloadFolder = result.downloadFolder || '';
    document.getElementById('download-folder').value = downloadFolder;
    console.log('ダウンロード設定を読み込みました:', downloadFolder);
  } catch (error) {
    console.error('ダウンロード設定の読み込みに失敗しました:', error);
  }
}

// ダウンロード設定を保存する
async function saveDownloadSettings() {
  try {
    const downloadFolder = document.getElementById('download-folder').value.trim();
    await chrome.storage.sync.set({ downloadFolder: downloadFolder });
    
    // 保存完了メッセージを表示
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = '設定を保存しました';
    statusDiv.className = 'status success';
    statusDiv.style.display = 'block';
    
    console.log('ダウンロード設定を保存しました:', downloadFolder);
    
    // 3秒後にメッセージを消す
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  } catch (error) {
    console.error('ダウンロード設定の保存に失敗しました:', error);
    
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = '保存に失敗しました';
    statusDiv.className = 'status error';
    statusDiv.style.display = 'block';
  }
}

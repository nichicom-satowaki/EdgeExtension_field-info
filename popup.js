document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup DOMContentLoaded イベント発火');
  
  // デバッグ：HTML要素の存在確認
  const container = document.querySelector('.container');
  const buttons = document.querySelectorAll('button');
  console.log('Container found:', !!container);
  console.log('Button count:', buttons.length);
  
  // 少し待ってからボタンの参照を取得（DOM要素が確実に読み込まれるまで）
  setTimeout(() => {
    console.log('initializeButtons実行中...');
    initializeButtons();
  }, 10);
});

function initializeButtons() {
  // ボタンの参照を取得
  const btnUnyou = document.getElementById('btn-unyou');
  const btnYobou = document.getElementById('btn-yobou');
  const btnSeijin = document.getElementById('btn-seijin');
  const btnBoshi = document.getElementById('btn-boshi');
  
  // 設定状態を更新
  const configStatus = document.getElementById('config-status');
  if (configStatus) {
    configStatus.textContent = '準備完了';
  }
  
  console.log('Buttons found:', {
    unyou: !!btnUnyou,
    yobou: !!btnYobou,
    seijin: !!btnSeijin,
    boshi: !!btnBoshi
  });

  // 母子保健ボタンのクリックイベント
  if (btnBoshi) {
    btnBoshi.addEventListener('click', async () => {
    try {
      // アクティブなタブを取得
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // field-infoページかどうかチェック（複数環境対応）
      if (!tab.url.includes('/core/setup/field-info')) {
        alert('field-infoページでこの機能を使用してください。');
        return;
      }

      // シンプルに固定のDTO名を使用
      const dtoName = 'A103PregnancyDto';
      console.log('使用するDTO名:', dtoName);

      // コンテンツスクリプトを確実に注入
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
      } catch (scriptError) {
        console.log('コンテンツスクリプトは既に読み込まれています:', scriptError.message);
      }

      // 少し待ってからメッセージを送信
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'filterAndNavigate',
            dtoName: dtoName
          });
          // ポップアップを閉じる
          window.close();
        } catch (messageError) {
          console.error('メッセージ送信エラー:', messageError);
          alert('コンテンツスクリプトに接続できませんでした。ページを再読み込みして再試行してください。');
        }
      }, 100);

    } catch (error) {
      console.error('母子保健ボタンエラー:', error);
      if (error.message.includes('sync')) {
        alert('設定の読み込みに失敗しました。デフォルト設定で実行します。');
        // デフォルト設定で再試行
        setTimeout(async () => {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            });
            setTimeout(async () => {
              await chrome.tabs.sendMessage(tab.id, {
                action: 'filterAndNavigate',
                dtoName: 'A103PregnancyDto'
              });
              window.close();
            }, 100);
          } catch (retryError) {
            console.error('再試行エラー:', retryError);
            alert('処理に失敗しました。ページを再読み込みして再試行してください。');
          }
        }, 100);
      } else {
        alert('エラーが発生しました: ' + error.message);
      }
    }
    });
  }

  // 他のボタンのクリックイベント
  if (btnUnyou) {
    btnUnyou.addEventListener('click', () => {
      alert('運用管理機能は未実装です。');
    });
  }

  if (btnYobou) {
    btnYobou.addEventListener('click', () => {
      alert('予防接種機能は未実装です。');
    });
  }

  if (btnSeijin) {
    btnSeijin.addEventListener('click', () => {
      alert('成人保健機能は未実装です。');
    });
  }

  console.log('すべてのボタンのイベントリスナーが設定されました');
}
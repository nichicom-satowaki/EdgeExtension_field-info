// 現在の設定（固定値）
const CURRENT_SETTINGS = {
  unyou: '未設定',
  yobou: '未設定',
  seijin: '未設定',
  boshi: 'A103PregnancyDto'
};

// ページが読み込まれたときの初期化
document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
});

// 設定を読み込む
function loadSettings() {
  try {
    // 固定値を表示
    document.getElementById('unyou-value').textContent = CURRENT_SETTINGS.unyou;
    document.getElementById('yobou-value').textContent = CURRENT_SETTINGS.yobou;
    document.getElementById('seijin-value').textContent = CURRENT_SETTINGS.seijin;
    document.getElementById('boshi-value').textContent = CURRENT_SETTINGS.boshi;
    
    console.log('現在の設定を表示しました:', CURRENT_SETTINGS);
  } catch (error) {
    console.error('設定の表示に失敗しました:', error);
  }
}


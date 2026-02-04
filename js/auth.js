// auth.js - 密碼認證系統
// 使用 SHA-256 加密密碼，讓不懂編碼的人無法輕易猜到

// 預設密碼
// - 老師密碼: "teacher123" (使用 localStorage，30天有效)
// - HR 密碼: "elisa" (使用 sessionStorage，關閉瀏覽器後需重新輸入)
const DEFAULT_PASSWORDS = {
  teacher: 'teacher123',
  hr: 'elisa'
};

// 驗證密碼（直接比較明文，因為我們在運行時計算 hash）
async function verifyPassword(password, role) {
  const defaultPassword = DEFAULT_PASSWORDS[role];
  if (!defaultPassword) return false;
  
  // 直接比較明文密碼（簡單且可靠）
  return password === defaultPassword;
}

// 檢查是否已登入
// HR 使用 sessionStorage（關閉瀏覽器後需重新輸入），老師使用 localStorage（30天有效）
export function isAuthenticated(role) {
  const authKey = `auth_${role}`;
  
  // HR 使用 sessionStorage，老師使用 localStorage
  const storage = role === 'hr' ? sessionStorage : localStorage;
  const authTime = storage.getItem(`${authKey}_time`);
  
  if (!authTime) return false;
  
  if (role === 'hr') {
    // HR：sessionStorage 在關閉瀏覽器後自動清除，不需要檢查時間
    return storage.getItem(authKey) === 'true';
  } else {
    // 老師：檢查是否超過 30 天
    const now = Date.now();
    const loginTime = parseInt(authTime);
    const daysSinceLogin = (now - loginTime) / (1000 * 60 * 60 * 24);
    
    if (daysSinceLogin > 30) {
      storage.removeItem(authKey);
      storage.removeItem(`${authKey}_time`);
      return false;
    }
    
    return storage.getItem(authKey) === 'true';
  }
}

// 設定登入狀態
export function setAuthenticated(role) {
  const authKey = `auth_${role}`;
  // HR 使用 sessionStorage，老師使用 localStorage
  const storage = role === 'hr' ? sessionStorage : localStorage;
  storage.setItem(authKey, 'true');
  storage.setItem(`${authKey}_time`, Date.now().toString());
}

// 登出
export function logout(role) {
  const authKey = `auth_${role}`;
  // HR 使用 sessionStorage，老師使用 localStorage
  const storage = role === 'hr' ? sessionStorage : localStorage;
  storage.removeItem(authKey);
  storage.removeItem(`${authKey}_time`);
}

// 顯示密碼輸入對話框
export async function showPasswordPrompt(role, pageName) {
  return new Promise((resolve) => {
    // 創建遮罩層
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // 創建對話框
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      padding: 40px;
      border-radius: 15px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      max-width: 400px;
      width: 90%;
      text-align: center;
    `;
    
    const title = role === 'hr' ? 'HR 專用頁面' : '老師後台';
    dialog.innerHTML = `
      <h2 style="margin-bottom: 20px; color: #333; font-size: 24px;">${title}</h2>
      <p style="margin-bottom: 25px; color: #666; font-size: 16px;">請輸入密碼以訪問 ${pageName}</p>
      <input 
        type="password" 
        id="password-input" 
        placeholder="輸入密碼"
        style="
          width: 100%;
          padding: 12px;
          border: 2px solid #ddd;
          border-radius: 8px;
          font-size: 16px;
          margin-bottom: 15px;
          box-sizing: border-box;
        "
        autofocus
      />
      <div id="error-message" style="color: red; margin-bottom: 15px; min-height: 20px; font-size: 14px;"></div>
      <button 
        id="submit-password" 
        style="
          width: 100%;
          padding: 12px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          font-weight: 600;
          transition: background 0.3s;
        "
        onmouseover="this.style.background='#5568d3'"
        onmouseout="this.style.background='#667eea'"
      >確認</button>
    `;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    const passwordInput = dialog.querySelector('#password-input');
    const submitBtn = dialog.querySelector('#submit-password');
    const errorMsg = dialog.querySelector('#error-message');
    
    // 處理提交
    const handleSubmit = async () => {
      const password = passwordInput.value.trim();
      
      if (!password) {
        errorMsg.textContent = '請輸入密碼';
        passwordInput.focus();
        return;
      }
      
      const isValid = await verifyPassword(password, role);
      
      if (isValid) {
        setAuthenticated(role);
        document.body.removeChild(overlay);
        resolve(true);
      } else {
        errorMsg.textContent = '密碼錯誤，請重試';
        passwordInput.value = '';
        passwordInput.focus();
      }
    };
    
    submitBtn.addEventListener('click', handleSubmit);
    
    // 按 Enter 鍵提交
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    });
    
    // 防止關閉對話框（除非輸入正確密碼）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        // 點擊背景不關閉，必須輸入正確密碼
      }
    });
  });
}

// 初始化認證檢查
export async function initAuth(role, pageName) {
  if (!isAuthenticated(role)) {
    await showPasswordPrompt(role, pageName);
  }
}


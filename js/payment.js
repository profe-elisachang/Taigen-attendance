// payment.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc,
  getDoc,
  setDoc,
  getDocs, 
  query, 
  where,
  orderBy,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig } from './config.js';

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM 元素
const monthSelectPayment = document.getElementById('month-select-payment');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const paymentContent = document.getElementById('payment-content');
let invoiceDateInput = null; // 將在 renderPayment 中創建

// 設定預設月份為當前月份
const now = new Date();
monthSelectPayment.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// 老師資訊（可以之後移到設定檔）
const teacherInfo = {
  name: 'Elisa Chang',
  phone: '479-139 8479',
  email: 'elisachangn@gmail.com',
  bankAccount: {
    bank: 'Citibanamex',
    accountHolder: 'HSIN-YU CHEN',
    accountNumber: '423096330201',
    clabe: '002225904430137914'
  }
};

// 公司資訊
const companyInfo = {
  name: 'Taigene Mexico',
  address: '37668 Leon, Guanajuato',
  phone: '477 100 3878'
};

// 狀態
let allClasses = [];
let allSessions = [];
let currentNotes = ''; // 當前月份的備註
let notesSaveTimeout = null; // 自動儲存延遲計時器

// 初始化
async function init() {
  await loadClasses();
  await loadSessions();
  await loadNotes(); // 載入備註
  renderPayment();
  
  // 監聽事件
  monthSelectPayment.addEventListener('change', handleMonthChange);
  exportPdfBtn.addEventListener('click', handleExportPDF);
}

// 載入班級列表
async function loadClasses() {
  try {
    const classesRef = collection(db, 'classes');
    const q = query(classesRef, where('active', '==', true));
    const snapshot = await getDocs(q);
    
    allClasses = [];
    snapshot.forEach(doc => {
      allClasses.push({
        id: doc.id,
        name: doc.data().name,
        hourRate: doc.data().hour_rate || 400
      });
    });
  } catch (error) {
    console.error('Failed to load classes:', error);
  }
}

// 載入 sessions
async function loadSessions() {
  try {
    const selectedMonth = monthSelectPayment.value;
    if (!selectedMonth) return;
    
    const [year, month] = selectedMonth.split('-');
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    const sessionsRef = collection(db, 'sessions');
    const q = query(
      sessionsRef,
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date')
    );
    
    const snapshot = await getDocs(q);
    allSessions = [];
    snapshot.forEach(doc => {
      allSessions.push({
        id: doc.id,
        ...doc.data()
      });
    });
  } catch (error) {
    console.error('Failed to load sessions:', error);
    allSessions = [];
  }
}

// 載入備註
async function loadNotes() {
  try {
    const selectedMonth = monthSelectPayment.value;
    if (!selectedMonth) {
      currentNotes = '';
      return;
    }
    
    const notesRef = doc(db, 'payment_notes', selectedMonth);
    const notesDoc = await getDoc(notesRef);
    
    if (notesDoc.exists()) {
      currentNotes = notesDoc.data().notes || '';
    } else {
      currentNotes = '';
    }
  } catch (error) {
    console.error('Failed to load notes:', error);
    currentNotes = '';
  }
}

// 儲存備註（自動儲存，延遲執行）
async function saveNotes(notes) {
  try {
    const selectedMonth = monthSelectPayment.value;
    if (!selectedMonth) return;
    
    const notesRef = doc(db, 'payment_notes', selectedMonth);
    await setDoc(notesRef, {
      month: selectedMonth,
      notes: notes,
      updated_at: serverTimestamp()
    }, { merge: true });
    
    console.log('Notes saved successfully');
  } catch (error) {
    console.error('Failed to save notes:', error);
  }
}

// 處理備註輸入（自動儲存，延遲 1 秒）
function handleNotesInput(notes) {
  currentNotes = notes;
  
  // 清除之前的計時器
  if (notesSaveTimeout) {
    clearTimeout(notesSaveTimeout);
  }
  
  // 延遲 1 秒後儲存
  notesSaveTimeout = setTimeout(() => {
    saveNotes(notes);
  }, 1000);
}

// 處理月份變更
async function handleMonthChange() {
  await loadSessions();
  await loadNotes(); // 載入新月份的備註
  renderPayment();
}

// 渲染請款單
function renderPayment() {
  paymentContent.innerHTML = '<div class="loading">Loading...</div>';
  
  if (allClasses.length === 0 || allSessions.length === 0) {
    paymentContent.innerHTML = '<div class="empty-state">No data available</div>';
    return;
  }
  
  const selectedMonth = monthSelectPayment.value;
  const [year, month] = selectedMonth.split('-');
  const defaultInvoiceDate = new Date().toISOString().split('T')[0]; // 預設為今天
  
  // 簡化的表頭 - 更緊湊的設計
  let html = `
    <div class="payment-top">
      <div class="teacher-info">
        <div class="info-section-title">Teacher Information</div>
        <div class="info-row">
          <span class="info-label">Name:</span>
          <span class="info-value">${teacherInfo.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Phone:</span>
          <span class="info-value">${teacherInfo.phone}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${teacherInfo.email}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Bank:</span>
          <span class="info-value">${teacherInfo.bankAccount.bank}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Account Holder:</span>
          <span class="info-value">${teacherInfo.bankAccount.accountHolder}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Account #:</span>
          <span class="info-value">${teacherInfo.bankAccount.accountNumber}</span>
        </div>
        <div class="info-row">
          <span class="info-label">CLABE:</span>
          <span class="info-value">${teacherInfo.bankAccount.clabe}</span>
        </div>
      </div>
      
      <div class="payment-info">
        <div class="info-section-title">Invoice Information</div>
        <div class="info-row">
          <span class="info-label">Invoice #:</span>
          <span class="info-value">${year}-${month}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Invoice Date:</span>
          <input type="date" id="invoice-date-input" class="invoice-date-input" value="${defaultInvoiceDate}">
        </div>
        <div class="info-row">
          <span class="info-label">Position:</span>
          <span class="info-value">Language Teacher</span>
        </div>
        <div class="info-row">
          <span class="info-label">Bill to:</span>
          <span class="info-value">${companyInfo.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Address:</span>
          <span class="info-value">${companyInfo.address}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Phone:</span>
          <span class="info-value">${companyInfo.phone}</span>
        </div>
      </div>
    </div>
  `;
  
  // 計算總時數和金額
  let totalHours = 0;
  let totalAmount = 0;
  const courseRows = []; // 儲存每個課程的資料
  
  // 計算每個課程的時數和金額
  allClasses.forEach(classData => {
    const classSessions = allSessions.filter(s => s.class_id === classData.id);
    
    if (classSessions.length === 0) return;
    
    // 只計算老師實際出席的 session（paid_hours: 1）
    // 排除已取消的 session（paid_hours: 0 或 cancelled: true）
    const paidSessions = classSessions.filter(session => {
      const paidHours = session.paid_hours !== undefined ? session.paid_hours : 1; // 舊資料可能沒有 paid_hours，預設為 1
      const isCancelled = session.cancelled || paidHours === 0;
      return !isCancelled;
    });
    
    const classHours = paidSessions.length; // 每個 session 都是 1 小時
    const classAmount = classHours * classData.hourRate;
    totalHours += classHours;
    totalAmount += classAmount;
    
    courseRows.push({
      name: classData.name,
      hours: classHours,
      rate: classData.hourRate,
      amount: classAmount
    });
  });
  
  // 課程列表表格 - 只顯示總時數
  html += `
    <div class="courses-section">
      <h3 class="courses-title">Courses</h3>
      <table class="courses-table">
        <thead>
          <tr>
            <th>Course Name</th>
            <th>Hours</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  courseRows.forEach(course => {
    html += `
      <tr>
        <td class="course-name">${course.name}</td>
        <td class="course-hours">${course.hours}</td>
        <td class="course-rate">$ ${course.rate.toLocaleString()}</td>
        <td class="course-amount">$ ${course.amount.toLocaleString()}</td>
      </tr>
    `;
  });
  
  html += `
        </tbody>
      </table>
    </div>
  `;
  
  // 總計
  html += `
    <div class="payment-summary">
      <div class="summary-content">
        <div class="summary-row">
          <span class="summary-label">Total Hours:</span>
          <span class="summary-value">${totalHours}</span>
        </div>
        <div class="summary-row summary-total">
          <span class="summary-label">Total Amount:</span>
          <span class="summary-value">$ ${totalAmount.toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;
  
  // 備註區塊
  html += `
    <div class="payment-notes-section">
      <h3 class="notes-title">Notes</h3>
      <textarea 
        id="payment-notes-input" 
        class="notes-input" 
        placeholder="Enter notes here (auto-saved)..."
        rows="4"
      >${currentNotes}</textarea>
      <div class="notes-hint">Notes are automatically saved after 1 second of inactivity</div>
    </div>
  `;
  
  paymentContent.innerHTML = html;
  
  // 綁定請款日期輸入欄位
  invoiceDateInput = document.getElementById('invoice-date-input');
  if (invoiceDateInput) {
    invoiceDateInput.addEventListener('change', () => {
      // 更新顯示的日期（如果需要即時更新）
      // 列印時會使用這個值
    });
  }
  
  // 綁定備註輸入欄位
  const notesInput = document.getElementById('payment-notes-input');
  if (notesInput) {
    notesInput.addEventListener('input', (e) => {
      handleNotesInput(e.target.value);
    });
  }
}

// 匯出 PDF
function handleExportPDF() {
  window.print();
}

// 啟動
init();


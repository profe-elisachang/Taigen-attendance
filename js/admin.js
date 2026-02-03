// admin.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc,
  getDocs, 
  query, 
  where,
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig } from './config.js';

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM 元素
const datePicker = document.getElementById('date-picker');
const classSelect = document.getElementById('class-select');
const studentList = document.getElementById('student-list');
const progressText = document.getElementById('progress-text');
const saveBtn = document.getElementById('save-btn');
const manageClassBtn = document.getElementById('manage-class-btn');
const classModal = document.getElementById('class-modal');
const modalClose = document.getElementById('modal-close');
const newClassIdInput = document.getElementById('new-class-id');
const newClassNameInput = document.getElementById('new-class-name');
const newClassHourRateInput = document.getElementById('new-class-hour-rate');
const addClassBtn = document.getElementById('add-class-btn');
const classList = document.getElementById('class-list');
const studentSectionHeader = document.getElementById('student-section-header');
const currentClassName = document.getElementById('current-class-name');
const manageStudentBtn = document.getElementById('manage-student-btn');
const studentModal = document.getElementById('student-modal');
const studentModalClose = document.getElementById('student-modal-close');
const newStudentNameInput = document.getElementById('new-student-name');
const addStudentBtn = document.getElementById('add-student-btn');
const studentListModal = document.getElementById('student-list-modal');
const markTeacherPresentToggle = document.getElementById('mark-teacher-present-toggle');

// 狀態
let currentDate = new Date().toISOString().split('T')[0];
let currentClassId = null;
let currentStudents = [];
let currentAttendance = {};
let pendingChanges = false;

// 初始化
async function init() {
  // 設定今天日期
  datePicker.value = currentDate;
  
  // 載入班級列表
  await loadClasses();
  
  // 初始化按鈕狀態
  await updateMarkTeacherPresentButton();
  
  // 監聽事件
  datePicker.addEventListener('change', handleDateChange);
  classSelect.addEventListener('change', handleClassChange);
  saveBtn.addEventListener('click', handleSave);
  markTeacherPresentToggle.addEventListener('change', handleMarkTeacherPresent);
  manageClassBtn.addEventListener('click', openClassModal);
  modalClose.addEventListener('click', closeClassModal);
  addClassBtn.addEventListener('click', handleAddClass);
  manageStudentBtn.addEventListener('click', openStudentModal);
  studentModalClose.addEventListener('click', closeStudentModal);
  addStudentBtn.addEventListener('click', handleAddStudent);
  
  // 點擊 modal 背景關閉
  classModal.addEventListener('click', (e) => {
    if (e.target === classModal) {
      closeClassModal();
    }
  });
  
  studentModal.addEventListener('click', (e) => {
    if (e.target === studentModal) {
      closeStudentModal();
    }
  });
  
  // 防止離開頁面時遺失資料
  window.addEventListener('beforeunload', (e) => {
    if (pendingChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// 載入班級列表
async function loadClasses() {
  try {
    studentList.innerHTML = '<div class="loading">載入班級中...</div>';
    
    const classesRef = collection(db, 'classes');
    const q = query(classesRef, where('active', '==', true));
    const snapshot = await getDocs(q);
    
    classSelect.innerHTML = '<option value="">請選擇班級</option>';
    
    if (snapshot.empty) {
      classSelect.innerHTML = '<option value="">沒有可用的班級</option>';
      studentList.innerHTML = '<div class="empty-state">請先在 Firestore 建立班級資料</div>';
      return;
    }
    
    snapshot.forEach(doc => {
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.data().name;
      classSelect.appendChild(option);
    });
    
    // 自動選擇第一個班級
    if (snapshot.size > 0) {
      const previousClassId = currentClassId;
      classSelect.value = snapshot.docs[0].id;
      
      // 如果之前選擇的班級還在，保持選擇
      if (previousClassId && snapshot.docs.find(d => d.id === previousClassId)) {
        classSelect.value = previousClassId;
      }
      
      await handleClassChange();
    }
  } catch (error) {
    console.error('載入班級失敗:', error);
    studentList.innerHTML = '<div class="empty-state">載入班級失敗，請檢查 Firestore 連線</div>';
    alert('載入班級失敗，請重新整理頁面');
  }
}

// 處理日期變更
async function handleDateChange(e) {
  currentDate = e.target.value;
  if (currentClassId) {
    await loadAttendance();
    renderStudents();
    await updateMarkTeacherPresentButton();
  }
}

// 處理班級變更
async function handleClassChange(e) {
  currentClassId = classSelect.value;
  if (!currentClassId) {
    studentList.innerHTML = '';
    studentSectionHeader.style.display = 'none';
    updateProgress();
    return;
  }
  
  // 顯示學生區域標題
  const selectedOption = classSelect.options[classSelect.selectedIndex];
  if (selectedOption) {
    currentClassName.textContent = selectedOption.textContent + ' - 學生列表';
    studentSectionHeader.style.display = 'flex';
  }
  
  studentList.innerHTML = '<div class="loading">載入學生中...</div>';
  
  try {
    await loadStudents();
    await loadAttendance();
    renderStudents();
    await updateMarkTeacherPresentButton();
  } catch (error) {
    console.error('載入資料失敗:', error);
    studentList.innerHTML = '<div class="empty-state">載入資料失敗</div>';
  }
}

// 載入學生列表
async function loadStudents() {
  try {
    const studentsRef = collection(db, `classes/${currentClassId}/students`);
    const q = query(studentsRef, where('active', '==', true));
    const snapshot = await getDocs(q);
    
    currentStudents = [];
    snapshot.forEach(doc => {
      currentStudents.push({
        id: doc.id,
        name: doc.data().name
      });
    });
    
    // 按姓名排序
    currentStudents.sort((a, b) => a.name.localeCompare(b.name));
    
    if (currentStudents.length === 0) {
      throw new Error('沒有找到學生');
    }
  } catch (error) {
    console.error('載入學生失敗:', error);
    throw error;
  }
}

// 載入出缺席記錄（從 sessions）
async function loadAttendance() {
  try {
    const sessionId = `${currentDate}_${currentClassId}`;
    const sessionRef = doc(db, 'sessions', sessionId);
    const sessionDoc = await getDoc(sessionRef);
    
    if (sessionDoc.exists()) {
      currentAttendance = sessionDoc.data().attendance || {};
    } else {
      currentAttendance = {};
    }
  } catch (error) {
    console.error('載入出缺席記錄失敗:', error);
    currentAttendance = {};
  }
}

// 渲染學生列表
function renderStudents() {
  if (currentStudents.length === 0) {
    studentList.innerHTML = '<div class="empty-state">此班級沒有學生</div>';
    updateProgress();
    return;
  }
  
  studentList.innerHTML = '';
  
  currentStudents.forEach(student => {
    const card = createStudentCard(student);
    studentList.appendChild(card);
  });
  
  updateProgress();
}

// 建立學生卡片
function createStudentCard(student) {
  const card = document.createElement('div');
  card.className = 'student-card';
  
  const currentStatus = currentAttendance[student.id] || null;
  
  card.innerHTML = `
    <div class="student-name">${student.name}</div>
    <div class="status-buttons">
      <button class="status-btn attend ${currentStatus === '1' ? 'active' : ''}" 
              data-student-id="${student.id}" 
              data-status="1">
        出席
      </button>
      <button class="status-btn absent ${currentStatus === 'x' ? 'active' : ''}" 
              data-student-id="${student.id}" 
              data-status="x">
        未出席
      </button>
      <button class="status-btn leave ${currentStatus === 'i' ? 'active' : ''}" 
              data-student-id="${student.id}" 
              data-status="i">
        請假
      </button>
    </div>
    <div class="current-status ${currentStatus ? 'has-status ' + getStatusClass(currentStatus) : ''}">
      目前狀態: ${getStatusText(currentStatus)}
    </div>
  `;
  
  // 綁定按鈕事件
  const buttons = card.querySelectorAll('.status-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => handleStatusClick(student.id, btn.dataset.status, btn));
  });
  
  return card;
}

// 處理狀態點擊
async function handleStatusClick(studentId, status, clickedBtn) {
  // 更新本地狀態
  if (currentAttendance[studentId] === status) {
    // 如果點擊相同狀態，清除記錄
    delete currentAttendance[studentId];
  } else {
    currentAttendance[studentId] = status;
  }
  
  // 重新渲染該卡片
  const card = clickedBtn.closest('.student-card');
  const student = currentStudents.find(s => s.id === studentId);
  if (student) {
    const newCard = createStudentCard(student);
    card.replaceWith(newCard);
  }
  
  // 標記有變更
  pendingChanges = true;
  saveBtn.disabled = false;
  updateProgress();
}

// 處理儲存（改為 sessions）
async function handleSave() {
  if (!currentClassId) return;
  
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';
    
    const sessionId = `${currentDate}_${currentClassId}`;
    const sessionRef = doc(db, 'sessions', sessionId);
    
    // 轉換日期字串為 timestamp
    const dateTimestamp = new Date(currentDate + 'T00:00:00');
    
    await setDoc(sessionRef, {
      date: dateTimestamp,
      class_id: currentClassId,
      paid_hours: 1,  // 固定為 1 小時
      attendance: currentAttendance,
      updated_at: serverTimestamp()
    }, { merge: true });
    
    pendingChanges = false;
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存變更';
    
    // 顯示成功訊息
    showMessage('✓ 已儲存', 'success');
    
  } catch (error) {
    console.error('儲存失敗:', error);
    showMessage('✗ 儲存失敗，請重試', 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = '儲存變更';
  }
}

// 標記/取消標記老師出席（Toggle Switch）
async function handleMarkTeacherPresent() {
  console.log('=== 開始處理標記/取消標記老師出席 ===');
  console.log('currentClassId:', currentClassId);
  console.log('currentDate:', currentDate);
  
  if (!currentClassId) {
    alert('請先選擇班級');
    markTeacherPresentToggle.checked = false;
    return;
  }
  
  const sessionId = `${currentDate}_${currentClassId}`;
  const sessionRef = doc(db, 'sessions', sessionId);
  
  // 檢查是否已存在 session
  console.log('檢查是否已存在 session...');
  const sessionDoc = await getDoc(sessionRef);
  const hasSession = sessionDoc.exists();
  const existingAttendance = hasSession ? (sessionDoc.data().attendance || {}) : {};
  const hasStudentRecords = hasSession && Object.keys(existingAttendance).length > 0;
  
  const isChecked = markTeacherPresentToggle.checked;
  
  console.log('hasSession:', hasSession);
  console.log('existingAttendance:', existingAttendance);
  console.log('hasStudentRecords:', hasStudentRecords);
  console.log('isChecked:', isChecked);
  
  if (isChecked) {
    // 標記老師出席
    if (hasSession && hasStudentRecords) {
      // 如果已有學生記錄，自動勾選（因為已經有 session）
      markTeacherPresentToggle.checked = true;
      markTeacherPresentToggle.disabled = true;
      return;
    }
    
    if (!hasSession) {
      // 建立新的 session
      try {
        markTeacherPresentToggle.disabled = true;
        
        // 轉換日期字串為 timestamp
        const dateTimestamp = new Date(currentDate + 'T00:00:00');
        console.log('dateTimestamp:', dateTimestamp);
        
        const newData = {
          date: dateTimestamp,
          class_id: currentClassId,
          paid_hours: 1,  // 固定為 1 小時
          attendance: {},  // 空物件，表示沒有學生記錄
          cancelled: false,  // 明確標記為未取消
          updated_at: serverTimestamp()
        };
        console.log('準備寫入的資料:', newData);
        
        console.log('開始寫入 Firestore...');
        await setDoc(sessionRef, newData, { merge: true });
        console.log('✓ 寫入成功');
        
        // 驗證寫入是否成功
        const verifyDoc = await getDoc(sessionRef);
        if (!verifyDoc.exists()) {
          throw new Error('寫入後驗證失敗：session 不存在於 Firestore');
        }
        console.log('✓ 驗證成功，session 已存在於 Firestore');
        
        markTeacherPresentToggle.disabled = false;
        updateMarkTeacherPresentButton();
        
        // 顯示成功訊息
        showMessage('✓ 已標記老師出席', 'success');
        
        // 重新載入出缺席記錄（更新顯示）
        await loadAttendance();
        renderStudents();
        await updateMarkTeacherPresentButton();
        console.log('=== 處理完成 ===');
        
      } catch (error) {
        console.error('標記失敗:', error);
        const errorMsg = error.message || error.code || '未知錯誤';
        showMessage(`✗ 標記失敗: ${errorMsg}`, 'error');
        markTeacherPresentToggle.checked = false;
        markTeacherPresentToggle.disabled = false;
        updateMarkTeacherPresentButton();
      }
    }
  } else {
    // 取消標記（刪除 session）
    if (hasStudentRecords) {
      // 如果已有學生記錄，不能取消標記
      alert('此日期已有學生出缺席記錄，無法取消標記老師出席');
      markTeacherPresentToggle.checked = true;
      return;
    }
    
    // ============================================
    // 【可選刪除】取消標記確認彈窗
    // 如果覺得 Toggle switch 的視覺回饋已足夠，可以刪除以下 4 行（442-445 行）
    // 刪除後取消標記會直接執行，無需確認
    // ============================================
    if (!confirm(`確定要取消標記 ${currentDate} 這天老師的出席嗎？\n（此操作會刪除該日期的 session 記錄）`)) {
      markTeacherPresentToggle.checked = true;
      return;
    }
    // ============================================
    
    try {
      markTeacherPresentToggle.disabled = true;
      
      console.log('準備刪除 session:', sessionId);
      await deleteDoc(sessionRef);
      console.log('✓ 刪除成功');
      
      // 驗證刪除是否成功
      const verifyDoc = await getDoc(sessionRef);
      if (verifyDoc.exists()) {
        throw new Error('刪除後驗證失敗：session 仍然存在於 Firestore');
      }
      console.log('✓ 驗證成功，session 已從 Firestore 刪除');
      
      markTeacherPresentToggle.disabled = false;
      updateMarkTeacherPresentButton();
      
      // 顯示成功訊息
      showMessage('✓ 已取消標記老師出席', 'success');
      
      // 重新載入出缺席記錄（更新顯示）
      await loadAttendance();
      renderStudents();
      await updateMarkTeacherPresentButton();
      console.log('=== 處理完成 ===');
      
    } catch (error) {
      console.error('取消標記失敗:', error);
      const errorMsg = error.message || error.code || '未知錯誤';
      showMessage(`✗ 取消標記失敗: ${errorMsg}`, 'error');
      markTeacherPresentToggle.checked = true;
      markTeacherPresentToggle.disabled = false;
      updateMarkTeacherPresentButton();
    }
  }
}

// 更新標記老師出席 Toggle Switch 的狀態
async function updateMarkTeacherPresentButton() {
  if (!currentClassId) {
    markTeacherPresentToggle.style.display = 'none';
    return;
  }
  
  const sessionId = `${currentDate}_${currentClassId}`;
  const sessionRef = doc(db, 'sessions', sessionId);
  const sessionDoc = await getDoc(sessionRef);
  const hasSession = sessionDoc.exists();
  const existingAttendance = hasSession ? (sessionDoc.data().attendance || {}) : {};
  const hasStudentRecords = hasSession && Object.keys(existingAttendance).length > 0;
  
  markTeacherPresentToggle.style.display = 'inline-flex';
  
  if (hasSession && !hasStudentRecords) {
    // 有 session 但沒有學生記錄，可以切換
    markTeacherPresentToggle.checked = true;
    markTeacherPresentToggle.disabled = false;
  } else if (hasSession && hasStudentRecords) {
    // 有 session 且有學生記錄，已標記且不可取消
    markTeacherPresentToggle.checked = true;
    markTeacherPresentToggle.disabled = true;
  } else {
    // 沒有 session，未標記
    markTeacherPresentToggle.checked = false;
    markTeacherPresentToggle.disabled = false;
  }
}

// 顯示訊息
function showMessage(text, type) {
  const msg = document.createElement('div');
  msg.textContent = text;
  msg.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#27ae60' : '#e74c3c'};
    color: white;
    padding: 1rem 2rem;
    border-radius: 6px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-weight: 600;
  `;
  document.body.appendChild(msg);
  setTimeout(() => {
    msg.style.transition = 'opacity 0.3s';
    msg.style.opacity = '0';
    setTimeout(() => msg.remove(), 300);
  }, 2000);
}

// 更新進度
function updateProgress() {
  const total = currentStudents.length;
  const completed = Object.keys(currentAttendance).length;
  progressText.textContent = `已完成: ${completed} / ${total}`;
}

// 輔助函數
function getStatusText(status) {
  if (!status) return '未記錄';
  const map = {
    '1': '✓ 出席',
    'x': '✗ 未出席',
    'i': '○ 請假'
  };
  return map[status] || '未知';
}

function getStatusClass(status) {
  const map = {
    '1': 'attend',
    'x': 'absent',
    'i': 'leave'
  };
  return map[status] || '';
}

// 開啟班級管理 Modal
function openClassModal() {
  classModal.classList.add('show');
  loadClassList();
}

// 關閉班級管理 Modal
function closeClassModal() {
  classModal.classList.remove('show');
  // 清空表單
  newClassIdInput.value = '';
  newClassNameInput.value = '';
}

// 載入班級列表（在 Modal 中顯示）
async function loadClassList() {
  try {
    const classesRef = collection(db, 'classes');
    const snapshot = await getDocs(classesRef);
    
    classList.innerHTML = '';
    
    if (snapshot.empty) {
      classList.innerHTML = '<div class="empty-state">還沒有班級</div>';
      return;
    }
    
    snapshot.forEach(doc => {
      const classData = doc.data();
      const classItem = createClassListItem(doc.id, classData);
      classList.appendChild(classItem);
    });
  } catch (error) {
    console.error('載入班級列表失敗:', error);
    classList.innerHTML = '<div class="empty-state">載入失敗</div>';
  }
}

// 建立班級列表項目
function createClassListItem(classId, classData) {
  const item = document.createElement('div');
  item.className = 'class-item';
  item.dataset.classId = classId;
  
  const hourRate = classData.hour_rate || 400;
  const classDays = classData.class_days || [1, 2, 3, 4, 5];
  const weekdayNames = ['週一', '週二', '週三', '週四', '週五'];
  const classDaysText = classDays.map(d => weekdayNames[d - 1]).join('、');
  
  item.innerHTML = `
    <div class="class-item-info">
      <div class="class-item-id">ID: ${classId}</div>
      <div class="class-item-name">${classData.name}</div>
      <div class="class-item-rate">時薪: $${hourRate}</div>
      <div class="class-item-days">上課天數: ${classDaysText}</div>
    </div>
    <div class="class-item-actions">
      <button class="form-btn primary edit-class-btn" data-class-id="${classId}">編輯</button>
      <button class="form-btn danger delete-class-btn" data-class-id="${classId}">刪除</button>
    </div>
  `;
  
  // 綁定編輯按鈕
  const editBtn = item.querySelector('.edit-class-btn');
  editBtn.addEventListener('click', () => editClass(classId, classData.name, hourRate, classDays, item));
  
  // 綁定刪除按鈕
  const deleteBtn = item.querySelector('.delete-class-btn');
  deleteBtn.addEventListener('click', () => deleteClass(classId));
  
  return item;
}

// 新增班級
async function handleAddClass() {
  const classId = newClassIdInput.value.trim();
  const className = newClassNameInput.value.trim();
  const hourRate = parseFloat(newClassHourRateInput.value) || 400;
  
  // 取得選取的上課天數
  const weekdayCheckboxes = document.querySelectorAll('#new-class-weekdays input[type="checkbox"]:checked');
  const classDays = Array.from(weekdayCheckboxes).map(cb => parseInt(cb.value));
  
  if (!classId) {
    alert('請輸入班級 ID');
    return;
  }
  
  if (!className) {
    alert('請輸入班級名稱');
    return;
  }
  
  if (hourRate < 0) {
    alert('時薪不能為負數');
    return;
  }
  
  if (classDays.length === 0) {
    alert('請至少選擇一個上課天數');
    return;
  }
  
  // 檢查 ID 格式（建議只包含小寫字母、數字、底線）
  if (!/^[a-z0-9_]+$/.test(classId)) {
    alert('班級 ID 只能包含小寫字母、數字和底線');
    return;
  }
  
  try {
    addClassBtn.disabled = true;
    addClassBtn.textContent = '新增中...';
    
    // 檢查班級 ID 是否已存在
    const classRef = doc(db, 'classes', classId);
    const classDoc = await getDoc(classRef);
    
    if (classDoc.exists()) {
      alert('此班級 ID 已存在');
      addClassBtn.disabled = false;
      addClassBtn.textContent = '新增班級';
      return;
    }
    
    // 建立新班級
    await setDoc(classRef, {
      name: className,
      hour_rate: hourRate,
      class_days: classDays, // 上課天數陣列，例如 [1, 3, 5] 表示週一、週三、週五
      active: true
    });
    
    showMessage('✓ 班級新增成功', 'success');
    
    // 清空表單
    newClassIdInput.value = '';
    newClassNameInput.value = '';
    newClassHourRateInput.value = '400';
    
    // 重新載入班級列表和下拉選單
    await loadClassList();
    await loadClasses();
    
    // 自動選擇新建立的班級
    classSelect.value = classId;
    await handleClassChange();
    
    addClassBtn.disabled = false;
    addClassBtn.textContent = '新增班級';
    
  } catch (error) {
    console.error('新增班級失敗:', error);
    showMessage('✗ 新增班級失敗', 'error');
    addClassBtn.disabled = false;
    addClassBtn.textContent = '新增班級';
  }
}

// 編輯班級
function editClass(classId, currentName, currentHourRate, currentClassDays, itemElement) {
  // 如果已經在編輯模式，先取消
  const existingInputs = itemElement.querySelectorAll('input');
  if (existingInputs.length > 0) {
    // 恢復顯示模式
    const infoDiv = itemElement.querySelector('.class-item-info');
    const weekdayNames = ['週一', '週二', '週三', '週四', '週五'];
    const classDaysText = currentClassDays.map(d => weekdayNames[d - 1]).join('、');
    infoDiv.innerHTML = `
      <div class="class-item-id">ID: ${classId}</div>
      <div class="class-item-name">${currentName}</div>
      <div class="class-item-rate">時薪: $${currentHourRate}</div>
      <div class="class-item-days">上課天數: ${classDaysText}</div>
    `;
    existingInputs.forEach(input => input.remove());
    itemElement.classList.remove('editing');
    return;
  }
  
  // 進入編輯模式
  itemElement.classList.add('editing');
  const infoDiv = itemElement.querySelector('.class-item-info');
  const weekdayNames = ['週一', '週二', '週三', '週四', '週五'];
  
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = currentName;
  nameInput.className = 'form-input';
  nameInput.placeholder = '班級名稱';
  
  const rateInput = document.createElement('input');
  rateInput.type = 'number';
  rateInput.value = currentHourRate;
  rateInput.className = 'form-input';
  rateInput.placeholder = '時薪';
  rateInput.min = '0';
  
  // 上課天數複選框
  const weekdaysContainer = document.createElement('div');
  weekdaysContainer.className = 'weekday-checkboxes';
  weekdayNames.forEach((name, index) => {
    const day = index + 1;
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = day;
    checkbox.checked = currentClassDays.includes(day);
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' ' + name));
    weekdaysContainer.appendChild(label);
  });
  
  infoDiv.innerHTML = '';
  infoDiv.appendChild(document.createElement('div')).textContent = `ID: ${classId}`;
  infoDiv.appendChild(nameInput);
  infoDiv.appendChild(rateInput);
  infoDiv.appendChild(weekdaysContainer);
  
  // 聚焦名稱輸入框
  nameInput.focus();
  nameInput.select();
  
  // 處理儲存
  const saveEdit = async () => {
    const newName = nameInput.value.trim();
    const newRate = parseFloat(rateInput.value) || 0;
    const weekdayCheckboxes = weekdaysContainer.querySelectorAll('input[type="checkbox"]:checked');
    const newClassDays = Array.from(weekdayCheckboxes).map(cb => parseInt(cb.value));
    
    if (!newName) {
      alert('班級名稱不能為空');
      nameInput.focus();
      return;
    }
    
    if (newRate < 0) {
      alert('時薪不能為負數');
      rateInput.focus();
      return;
    }
    
    if (newClassDays.length === 0) {
      alert('請至少選擇一個上課天數');
      return;
    }
    
    const nameChanged = newName !== currentName;
    const rateChanged = newRate !== currentHourRate;
    const daysChanged = JSON.stringify(newClassDays.sort()) !== JSON.stringify(currentClassDays.sort());
    
    if (!nameChanged && !rateChanged && !daysChanged) {
      // 沒有變更，取消編輯
      const classDaysText = currentClassDays.map(d => weekdayNames[d - 1]).join('、');
      infoDiv.innerHTML = `
        <div class="class-item-id">ID: ${classId}</div>
        <div class="class-item-name">${currentName}</div>
        <div class="class-item-rate">時薪: $${currentHourRate}</div>
        <div class="class-item-days">上課天數: ${classDaysText}</div>
      `;
      itemElement.classList.remove('editing');
      return;
    }
    
    try {
      const classRef = doc(db, 'classes', classId);
      await setDoc(classRef, {
        name: newName,
        hour_rate: newRate,
        class_days: newClassDays,
        active: true
      }, { merge: true });
      
      // 更新顯示
      const classDaysText = newClassDays.map(d => weekdayNames[d - 1]).join('、');
      infoDiv.innerHTML = `
        <div class="class-item-id">ID: ${classId}</div>
        <div class="class-item-name">${newName}</div>
        <div class="class-item-rate">時薪: $${newRate}</div>
        <div class="class-item-days">上課天數: ${classDaysText}</div>
      `;
      itemElement.classList.remove('editing');
      
      // 更新本地資料
      currentName = newName;
      currentHourRate = newRate;
      currentClassDays = newClassDays;
      
      showMessage('✓ 班級資料已更新', 'success');
      
      // 重新載入下拉選單
      await loadClasses();
      
    } catch (error) {
      console.error('更新班級資料失敗:', error);
      showMessage('✗ 更新失敗', 'error');
    }
  };
  
  // Enter 鍵儲存
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      rateInput.focus();
    }
  });
  
  rateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      // ESC 取消編輯
      const classDaysText = currentClassDays.map(d => weekdayNames[d - 1]).join('、');
      infoDiv.innerHTML = `
        <div class="class-item-id">ID: ${classId}</div>
        <div class="class-item-name">${currentName}</div>
        <div class="class-item-rate">時薪: $${currentHourRate}</div>
        <div class="class-item-days">上課天數: ${classDaysText}</div>
      `;
      itemElement.classList.remove('editing');
    }
  });
  
  // 失去焦點時儲存（如果所有輸入框都失去焦點）
  let blurTimeout;
  const handleBlur = () => {
    blurTimeout = setTimeout(() => {
      if (document.activeElement !== nameInput && 
          document.activeElement !== rateInput &&
          !weekdaysContainer.contains(document.activeElement)) {
        saveEdit();
      }
    }, 200);
  };
  
  nameInput.addEventListener('blur', handleBlur);
  rateInput.addEventListener('blur', handleBlur);
}

// 刪除班級
async function deleteClass(classId) {
  if (!confirm(`確定要刪除班級 "${classId}" 嗎？\n\n注意：這只會將班級標記為 inactive，不會刪除出缺席記錄。`)) {
    return;
  }
  
  try {
    const classRef = doc(db, 'classes', classId);
    await setDoc(classRef, {
      active: false
    }, { merge: true });
    
    showMessage('✓ 班級已停用', 'success');
    
    // 重新載入
    await loadClassList();
    await loadClasses();
    
    // 如果刪除的是當前選擇的班級，清空選擇
    if (currentClassId === classId) {
      classSelect.value = '';
      currentClassId = null;
      studentList.innerHTML = '';
      updateProgress();
    }
    
  } catch (error) {
    console.error('刪除班級失敗:', error);
    showMessage('✗ 刪除失敗', 'error');
  }
}

// 開啟學生管理 Modal
function openStudentModal() {
  if (!currentClassId) {
    alert('請先選擇班級');
    return;
  }
  studentModal.classList.add('show');
  loadStudentListModal();
}

// 關閉學生管理 Modal
function closeStudentModal() {
  studentModal.classList.remove('show');
  // 清空表單
  newStudentNameInput.value = '';
}

// 載入學生列表（在 Modal 中顯示）
async function loadStudentListModal() {
  try {
    if (!currentClassId) return;
    
    const studentsRef = collection(db, `classes/${currentClassId}/students`);
    const snapshot = await getDocs(studentsRef);
    
    studentListModal.innerHTML = '';
    
    if (snapshot.empty) {
      studentListModal.innerHTML = '<div class="empty-state">還沒有學生</div>';
      return;
    }
    
    // 分組顯示：active 和 inactive
    const activeStudents = [];
    const inactiveStudents = [];
    
    snapshot.forEach(doc => {
      const studentData = doc.data();
      const student = {
        id: doc.id,
        name: studentData.name,
        hourRate: studentData.hour_rate || 0,
        active: studentData.active !== false
      };
      
      if (student.active) {
        activeStudents.push(student);
      } else {
        inactiveStudents.push(student);
      }
    });
    
    // 排序
    activeStudents.sort((a, b) => a.name.localeCompare(b.name));
    inactiveStudents.sort((a, b) => a.name.localeCompare(b.name));
    
    // 顯示 active 學生
    activeStudents.forEach(student => {
      const item = createStudentListItem(student);
      studentListModal.appendChild(item);
    });
    
    // 顯示 inactive 學生（如果有）
    if (inactiveStudents.length > 0) {
      const inactiveHeader = document.createElement('div');
      inactiveHeader.className = 'inactive-header';
      inactiveHeader.textContent = '已停用學生';
      inactiveHeader.style.cssText = 'margin-top: 1.5rem; padding-top: 1.5rem; border-top: 2px solid #e0e0e0; font-weight: 600; color: #999; font-size: 0.9rem;';
      studentListModal.appendChild(inactiveHeader);
      
      inactiveStudents.forEach(student => {
        const item = createStudentListItem(student);
        studentListModal.appendChild(item);
      });
    }
    
  } catch (error) {
    console.error('載入學生列表失敗:', error);
    studentListModal.innerHTML = '<div class="empty-state">載入失敗</div>';
  }
}

// 建立學生列表項目
function createStudentListItem(student) {
  const item = document.createElement('div');
  item.className = 'student-item';
  item.dataset.studentId = student.id;
  
  if (!student.active) {
    item.style.opacity = '0.6';
  }
  
  item.innerHTML = `
    <div class="student-item-info">
      <div class="student-item-name">${student.name}</div>
    </div>
    <div class="student-item-actions">
      <button class="form-btn primary edit-student-btn" data-student-id="${student.id}">編輯</button>
      <button class="form-btn danger delete-student-btn" data-student-id="${student.id}">${student.active ? '停用' : '啟用'}</button>
    </div>
  `;
  
  // 綁定編輯按鈕
  const editBtn = item.querySelector('.edit-student-btn');
  editBtn.addEventListener('click', () => editStudent(student, item));
  
  // 綁定停用/啟用按鈕
  const toggleBtn = item.querySelector('.delete-student-btn');
  toggleBtn.addEventListener('click', () => toggleStudentActive(student.id, student.active));
  
  return item;
}

// 新增學生
async function handleAddStudent() {
  if (!currentClassId) {
    alert('請先選擇班級');
    return;
  }
  
  const studentName = newStudentNameInput.value.trim();
  
  if (!studentName) {
    alert('請輸入學生姓名');
    return;
  }
  
  try {
    addStudentBtn.disabled = true;
    addStudentBtn.textContent = '新增中...';
    
    // 建立新學生（使用自動生成的 ID）
    const studentsRef = collection(db, `classes/${currentClassId}/students`);
    const newStudentRef = doc(studentsRef);
    
    await setDoc(newStudentRef, {
      name: studentName,
      active: true
    });
    
    showMessage('✓ 學生新增成功', 'success');
    
    // 清空表單
    newStudentNameInput.value = '';
    
    // 重新載入學生列表
    await loadStudentListModal();
    await loadStudents();
    await loadAttendance();
    renderStudents();
    
    addStudentBtn.disabled = false;
    addStudentBtn.textContent = '新增學生';
    
  } catch (error) {
    console.error('新增學生失敗:', error);
    showMessage('✗ 新增學生失敗', 'error');
    addStudentBtn.disabled = false;
    addStudentBtn.textContent = '新增學生';
  }
}

// 編輯學生
function editStudent(student, itemElement) {
  // 如果已經在編輯模式，先取消
  const existingInput = itemElement.querySelector('input');
  if (existingInput) {
    // 恢復顯示模式
    const infoDiv = itemElement.querySelector('.student-item-info');
    infoDiv.innerHTML = `
      <div class="student-item-name">${student.name}</div>
    `;
    existingInput.remove();
    itemElement.classList.remove('editing');
    return;
  }
  
  // 進入編輯模式
  itemElement.classList.add('editing');
  const infoDiv = itemElement.querySelector('.student-item-info');
  
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = student.name;
  nameInput.className = 'form-input';
  nameInput.placeholder = '學生姓名';
  
  infoDiv.innerHTML = '';
  infoDiv.appendChild(nameInput);
  
  // 聚焦姓名輸入框
  nameInput.focus();
  nameInput.select();
  
  // 處理儲存
  const saveEdit = async () => {
    const newName = nameInput.value.trim();
    
    if (!newName) {
      alert('學生姓名不能為空');
      nameInput.focus();
      return;
    }
    
    if (newName === student.name) {
      // 沒有變更，取消編輯
      infoDiv.innerHTML = `
        <div class="student-item-name">${student.name}</div>
      `;
      itemElement.classList.remove('editing');
      return;
    }
    
    try {
      const studentRef = doc(db, `classes/${currentClassId}/students`, student.id);
      await setDoc(studentRef, {
        name: newName,
        active: student.active
      }, { merge: true });
      
      // 更新顯示
      infoDiv.innerHTML = `
        <div class="student-item-name">${newName}</div>
      `;
      itemElement.classList.remove('editing');
      
      // 更新本地資料
      student.name = newName;
      
      showMessage('✓ 學生資料已更新', 'success');
      
      // 重新載入學生列表
      await loadStudents();
      await loadAttendance();
      renderStudents();
      
    } catch (error) {
      console.error('更新學生資料失敗:', error);
      showMessage('✗ 更新失敗', 'error');
    }
  };
  
  // Enter 鍵儲存
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      // ESC 取消編輯
      infoDiv.innerHTML = `
        <div class="student-item-name">${student.name}</div>
      `;
      itemElement.classList.remove('editing');
    }
  });
  
  // 失去焦點時儲存
  nameInput.addEventListener('blur', saveEdit);
}

// 切換學生 active 狀態
async function toggleStudentActive(studentId, currentActive) {
  const action = currentActive ? '停用' : '啟用';
  if (!confirm(`確定要${action}此學生嗎？`)) {
    return;
  }
  
  try {
    const studentRef = doc(db, `classes/${currentClassId}/students`, studentId);
    await setDoc(studentRef, {
      active: !currentActive
    }, { merge: true });
    
    showMessage(`✓ 學生已${action}`, 'success');
    
    // 重新載入
    await loadStudentListModal();
    await loadStudents();
    await loadAttendance();
    renderStudents();
    
  } catch (error) {
    console.error('更新學生狀態失敗:', error);
    showMessage('✗ 更新失敗', 'error');
  }
}

// 啟動
init();


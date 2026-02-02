// calendar.js
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
const monthSelectCalendar = document.getElementById('month-select-calendar');
const monthSlider = document.getElementById('month-slider');
const classSelectCalendar = document.getElementById('class-select-calendar');
const saveCalendarBtn = document.getElementById('save-calendar-btn');
const progressTextCalendar = document.getElementById('progress-text-calendar');
const unsavedWarning = document.getElementById('unsaved-warning');
const calendarContent = document.getElementById('calendar-content');

// 設定預設月份為當前月份
const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
monthSelectCalendar.value = currentMonth;

// 狀態
let currentMonthValue = currentMonth;
let currentClassId = null;
let currentClassData = null; // 儲存當前班級的完整資料（包含 class_days）
let currentStudents = [];
let currentSessions = {}; // {dateKey: {studentId: status}}
let pendingChanges = false;
let allClasses = [];

// 初始化
async function init() {
  await loadClasses(); // 這會自動選擇第一個班級並調用 handleClassChange()，進而調用 renderCalendar()
  createMonthSlider();
  
  // 監聽事件
  monthSelectCalendar.addEventListener('change', handleMonthChange);
  classSelectCalendar.addEventListener('change', handleClassChange);
  saveCalendarBtn.addEventListener('click', handleSave);
  
  // 防止離開頁面時遺失資料
  window.addEventListener('beforeunload', (e) => {
    if (pendingChanges) {
      e.preventDefault();
      e.returnValue = '有未儲存的變更，確定要離開嗎？';
    }
  });
}

// 建立月份滑桿
function createMonthSlider() {
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  monthSlider.innerHTML = '';
  
  monthNames.forEach((name, index) => {
    const btn = document.createElement('button');
    btn.className = 'month-btn';
    btn.textContent = name;
    btn.dataset.month = index + 1;
    
    // 檢查是否為當前選擇的月份
    const [year, month] = currentMonthValue.split('-');
    if (parseInt(month) === index + 1) {
      btn.classList.add('active');
    }
    
    btn.addEventListener('click', () => {
      const [year] = currentMonthValue.split('-');
      const newMonth = `${year}-${String(index + 1).padStart(2, '0')}`;
      monthSelectCalendar.value = newMonth;
      handleMonthChange();
    });
    
    monthSlider.appendChild(btn);
  });
}

// 載入班級列表
async function loadClasses() {
  try {
    const classesRef = collection(db, 'classes');
    const q = query(classesRef, where('active', '==', true));
    const snapshot = await getDocs(q);
    
    allClasses = [];
    classSelectCalendar.innerHTML = '<option value="">請選擇班級</option>';
    
    snapshot.forEach(doc => {
      const classData = doc.data();
      allClasses.push({
        id: doc.id,
        name: classData.name,
        class_days: classData.class_days || [1, 2, 3, 4, 5] // 預設週一到週五
      });
      
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = classData.name;
      classSelectCalendar.appendChild(option);
    });
    
    // 自動選擇第一個班級
    if (snapshot.size > 0) {
      classSelectCalendar.value = snapshot.docs[0].id;
      await handleClassChange();
    }
  } catch (error) {
    console.error('載入班級失敗:', error);
  }
}

// 處理月份變更
async function handleMonthChange() {
  if (pendingChanges) {
    if (!confirm('有未儲存的變更，確定要切換月份嗎？')) {
      monthSelectCalendar.value = currentMonthValue;
      return;
    }
  }
  
  currentMonthValue = monthSelectCalendar.value;
  updateMonthSlider();
  
  // 如果有選擇班級，重新載入該月份的數據
  if (currentClassId) {
    await loadStudents();
    await loadSessions();
    renderCalendar();
  } else {
    // 如果沒有選擇班級，只清空顯示
    calendarContent.innerHTML = '<div class="empty-state">請選擇班級</div>';
  }
  
  pendingChanges = false;
  saveCalendarBtn.disabled = true;
  unsavedWarning.style.display = 'none';
}

// 更新月份滑桿狀態
function updateMonthSlider() {
  const [year, month] = currentMonthValue.split('-');
  const monthBtns = monthSlider.querySelectorAll('.month-btn');
  monthBtns.forEach(btn => {
    if (parseInt(btn.dataset.month) === parseInt(month)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// 處理班級變更
async function handleClassChange() {
  if (pendingChanges) {
    if (!confirm('有未儲存的變更，確定要切換班級嗎？')) {
      classSelectCalendar.value = currentClassId || '';
      return;
    }
  }
  
  currentClassId = classSelectCalendar.value;
  if (!currentClassId) {
    calendarContent.innerHTML = '<div class="empty-state">請選擇班級</div>';
    currentClassData = null;
    return;
  }
  
  // 取得當前班級的完整資料
  currentClassData = allClasses.find(c => c.id === currentClassId);
  if (!currentClassData) {
    // 如果找不到，從 Firestore 重新載入
    try {
      const classRef = doc(db, 'classes', currentClassId);
      const classDoc = await getDoc(classRef);
      if (classDoc.exists()) {
        const data = classDoc.data();
        currentClassData = {
          id: currentClassId,
          name: data.name,
          class_days: data.class_days || [1, 2, 3, 4, 5]
        };
        // 同時更新 allClasses 陣列
        const index = allClasses.findIndex(c => c.id === currentClassId);
        if (index >= 0) {
          allClasses[index] = currentClassData;
        } else {
          allClasses.push(currentClassData);
        }
      } else {
        console.error('班級不存在:', currentClassId);
        calendarContent.innerHTML = '<div class="empty-state">班級不存在</div>';
        currentClassData = null;
        return;
      }
    } catch (error) {
      console.error('載入班級資料失敗:', error);
      currentClassData = { id: currentClassId, name: '', class_days: [1, 2, 3, 4, 5] };
    }
  }
  
  console.log('handleClassChange - currentClassData:', currentClassData);
  
  await loadStudents();
  await loadSessions();
  renderCalendar();
  pendingChanges = false;
  saveCalendarBtn.disabled = true;
  unsavedWarning.style.display = 'none';
}

// 載入學生列表
async function loadStudents() {
  if (!currentClassId) {
    currentStudents = [];
    return;
  }
  
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
    
    currentStudents.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('載入學生失敗:', error);
    currentStudents = [];
  }
}

// 載入 sessions
async function loadSessions() {
  if (!currentClassId || !currentMonthValue) {
    currentSessions = {};
    return;
  }
  
  try {
    const [year, month] = currentMonthValue.split('-');
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    // 先查詢日期範圍，避免需要複合索引
    // 然後在記憶體中過濾 class_id
    const sessionsRef = collection(db, 'sessions');
    const q = query(
      sessionsRef,
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    );
    
    const snapshot = await getDocs(q);
    currentSessions = {};
    
    snapshot.forEach(doc => {
      const sessionData = doc.data();
      // 過濾出當前班級的 sessions
      if (sessionData.class_id === currentClassId) {
        const date = sessionData.date.toDate();
        const dateKey = date.toISOString().split('T')[0];
        // 儲存完整的 session 資訊，包括 paid_hours 和 cancelled
        currentSessions[dateKey] = {
          attendance: sessionData.attendance || {},
          paid_hours: sessionData.paid_hours || 1,
          cancelled: sessionData.cancelled || false
        };
      }
    });
  } catch (error) {
    console.error('載入 sessions 失敗:', error);
    currentSessions = {};
  }
}

// 渲染月曆表格
function renderCalendar() {
  console.log('renderCalendar 開始執行');
  console.log('currentClassId:', currentClassId);
  console.log('currentStudents.length:', currentStudents.length);
  console.log('currentMonthValue:', currentMonthValue);
  console.log('currentClassData:', currentClassData);
  
  if (!currentClassId || currentStudents.length === 0) {
    console.log('條件不滿足，顯示空狀態');
    calendarContent.innerHTML = '<div class="empty-state">請選擇班級</div>';
    return;
  }
  
  // 確保 currentClassData 存在
  if (!currentClassData) {
    console.error('currentClassData 為 null，嘗試重新載入');
    // 嘗試從 allClasses 中找到
    currentClassData = allClasses.find(c => c.id === currentClassId);
    if (!currentClassData) {
      console.error('無法找到班級資料，顯示錯誤');
      calendarContent.innerHTML = '<div class="empty-state">班級資料載入失敗，請重新選擇班級</div>';
      return;
    }
    console.log('從 allClasses 中找到班級資料:', currentClassData);
  }
  
  console.log('開始生成 HTML...');
  
  const [year, month] = currentMonthValue.split('-');
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay();
  
  // 調整星期：0=週日, 1=週一, ..., 6=週六
  const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1; // 轉換為週一=0, 週日=6
  
  let html = '<div class="calendar-table-wrapper"><table class="calendar-table">';
  
  const today = new Date();
  const isCurrentMonth = today.getFullYear() == year && today.getMonth() + 1 == month;
  const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
  
  // 日期標題行（第一行：顯示整個月的日期）
  html += '<thead><tr><th class="date-header student-col">學生</th>';
  
  // 取得班級的上課天數（轉換：0=週日, 1=週一, ..., 6=週六 → 1=週一, 2=週二, ..., 7=週日）
  const classDays = currentClassData?.class_days || [1, 2, 3, 4, 5];
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    // 轉換為 1=週一, 2=週二, ..., 7=週日
    const adjustedDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isToday = isCurrentMonth && day === today.getDate();
    const hasSession = currentSessions.hasOwnProperty(dateKey); // 檢查是否有實際 session
    const sessionInfo = hasSession ? currentSessions[dateKey] : null;
    const isCancelled = sessionInfo && (sessionInfo.cancelled || sessionInfo.paid_hours === 0); // 檢查是否已取消
    const isScheduledDay = classDays.includes(adjustedDayOfWeek); // 檢查是否為預定上課日
    
    let className = 'date-header';
    if (isWeekend) className += ' weekend';
    if (isToday) className += ' today';
    // 預定上課日或有實際 session 時都顯示為「老師出席」（綠色標記）
    // 但如果 session 已取消（paid_hours: 0 或 cancelled: true），則不顯示綠色
    if (!isWeekend) {
      if (hasSession && !isCancelled) {
        // 有 session 且未取消，顯示綠色
        className += ' teacher-present';
      } else if (!hasSession && isScheduledDay) {
        // 預定上課日且沒有 session，顯示綠色
        className += ' teacher-present';
      }
    }
    
    // 設定 title 提示文字
    let titleText = '';
    if (isWeekend) {
      titleText = '週末';
    } else if (hasSession && !isCancelled) {
      titleText = '點擊取消標記（國定假日等）';
    } else if (hasSession && isCancelled) {
      titleText = '已取消，點擊恢復標記';
    } else if (isScheduledDay) {
      titleText = '預定上課日，點擊取消標記（國定假日等）';
    } else {
      titleText = '點擊標記老師出席';
    }
    
    html += `<th class="${className}" data-date="${dateKey}" data-weekend="${isWeekend}" data-scheduled="${isScheduledDay}" data-has-session="${hasSession}" title="${titleText}">${day}</th>`;
  }
  html += '</tr>';
  
  // 星期標題行（第二行：顯示每個日期對應的星期）
  html += '<tr><th class="weekday-header student-col"></th>';
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    const adjustedDayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekdayName = weekdays[adjustedDayOfWeek];
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    let className = 'weekday-header';
    if (isWeekend) className += ' weekend';
    
    html += `<th class="${className}">${weekdayName}</th>`;
  }
  html += '</tr></thead>';
  
  // 學生行
  html += '<tbody>';
  currentStudents.forEach(student => {
    html += `<tr><td class="student-name-cell">${student.name}</td>`;
    
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const sessionInfo = currentSessions[dateKey];
      const status = sessionInfo?.attendance?.[student.id] || '';
      
      let className = 'attendance-cell';
      let statusText = '';
      
      if (isWeekend) {
        className += ' weekend readonly';
      } else {
        if (status === '1') {
          className += ' present';
          statusText = 'v';
        } else if (status === 'x') {
          className += ' absent';
          statusText = 'x';
        } else if (status === 'i') {
          className += ' leave';
          statusText = 'i';
        }
        
        // 綁定點擊事件
        html += `<td class="${className}" data-date="${dateKey}" data-student="${student.id}" data-status="${status}">`;
        html += `<div class="cell-status">${statusText}</div>`;
        html += '</td>';
        continue;
      }
      
      html += `<td class="${className}"><div class="cell-status"></div></td>`;
    }
    
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  
  console.log('HTML 生成完成，長度:', html.length);
  console.log('準備更新 calendarContent.innerHTML');
  console.log('calendarContent 元素:', calendarContent);
  
  try {
    if (!calendarContent) {
      throw new Error('calendarContent 元素不存在');
    }
    calendarContent.innerHTML = html;
    console.log('✓ calendarContent.innerHTML 更新成功');
    
    // 驗證 HTML 是否正確插入
    const table = calendarContent.querySelector('.calendar-table');
    if (!table) {
      throw new Error('表格元素未找到，HTML 可能未正確插入');
    }
    console.log('✓ 表格元素驗證成功');
  } catch (error) {
    console.error('更新 calendarContent.innerHTML 失敗:', error);
    console.error('錯誤堆疊:', error.stack);
    throw error;
  }
  
  // 綁定點擊事件 - 學生出缺席格子
  console.log('綁定學生出缺席格子點擊事件...');
  const cells = calendarContent.querySelectorAll('.attendance-cell:not(.weekend):not(.readonly)');
  console.log('找到', cells.length, '個可點擊的格子');
  cells.forEach(cell => {
    cell.addEventListener('click', handleCellClick);
  });
  
  // 綁定點擊事件 - 日期標題（標記老師出席）
  console.log('綁定日期標題點擊事件...');
  const dateHeaders = calendarContent.querySelectorAll('.date-header:not(.weekend):not(.student-col)');
  console.log('找到', dateHeaders.length, '個可點擊的日期標題');
  dateHeaders.forEach(header => {
    header.addEventListener('click', handleDateHeaderClick);
    header.style.cursor = 'pointer';
  });
  
  console.log('更新進度...');
  updateProgress();
  
  // 檢查按鈕狀態
  console.log('檢查按鈕狀態...');
  console.log('saveCalendarBtn.disabled:', saveCalendarBtn.disabled);
  console.log('pendingChanges:', pendingChanges);
  console.log('saveCalendarBtn:', saveCalendarBtn);
  
  console.log('✓ renderCalendar 完成');
}

// 處理格子點擊
function handleCellClick(e) {
  const cell = e.currentTarget;
  const dateKey = cell.dataset.date;
  const studentId = cell.dataset.student;
  const currentStatus = cell.dataset.status || '';
  
  // 循環切換：空白 → v → x → i → 空白
  let newStatus = '';
  if (currentStatus === '') {
    newStatus = '1'; // v
  } else if (currentStatus === '1') {
    newStatus = 'x';
  } else if (currentStatus === 'x') {
    newStatus = 'i';
  } else if (currentStatus === 'i') {
    newStatus = ''; // 空白
  }
  
  // 更新本地狀態
  if (!currentSessions[dateKey]) {
    currentSessions[dateKey] = {
      attendance: {},
      paid_hours: 1,
      cancelled: false
    };
  }
  
  if (newStatus === '') {
    delete currentSessions[dateKey].attendance[studentId];
    if (Object.keys(currentSessions[dateKey].attendance).length === 0) {
      // 如果沒有學生記錄，檢查是否為預定上課日
      const isScheduledDay = classDays.includes(adjustedDayOfWeek);
      if (!isScheduledDay) {
        // 不是預定上課日且沒有學生記錄，可以刪除
        delete currentSessions[dateKey];
      }
    }
  } else {
    currentSessions[dateKey].attendance[studentId] = newStatus;
    // 如果有學生記錄，確保 paid_hours 為 1 且未取消
    currentSessions[dateKey].paid_hours = 1;
    currentSessions[dateKey].cancelled = false;
  }
  
  // 更新顯示
  updateCellDisplay(cell, newStatus);
  
  // 標記有變更
  pendingChanges = true;
  saveCalendarBtn.disabled = false;
  unsavedWarning.style.display = 'inline';
  updateProgress();
}

// 更新格子顯示
function updateCellDisplay(cell, status) {
  cell.dataset.status = status;
  const statusDiv = cell.querySelector('.cell-status');
  
  // 移除所有狀態類別
  cell.classList.remove('present', 'absent', 'leave');
  
  if (status === '1') {
    cell.classList.add('present');
    statusDiv.textContent = 'v';
  } else if (status === 'x') {
    cell.classList.add('absent');
    statusDiv.textContent = 'x';
  } else if (status === 'i') {
    cell.classList.add('leave');
    statusDiv.textContent = 'i';
  } else {
    statusDiv.textContent = '';
  }
}

// 處理日期標題點擊（標記/取消標記老師出席）
async function handleDateHeaderClick(e) {
  const header = e.currentTarget;
  const dateKey = header.dataset.date;
  const isWeekend = header.dataset.weekend === 'true';
  const isScheduled = header.dataset.scheduled === 'true';
  
  console.log('=== 開始處理日期標題點擊 ===');
  console.log('dateKey:', dateKey);
  console.log('isWeekend:', isWeekend);
  console.log('isScheduled:', isScheduled);
  console.log('currentClassId:', currentClassId);
  
  if (isWeekend) {
    console.log('週末不可標記，返回');
    return; // 週末不可標記
  }
  
  if (!currentClassId) {
    console.log('未選擇班級');
    alert('請先選擇班級');
    return;
  }
  
  const hasSession = currentSessions.hasOwnProperty(dateKey);
  const sessionInfo = hasSession ? currentSessions[dateKey] : null;
  // 處理舊格式（直接是 attendance）的兼容性
  const isOldFormat = hasSession && !sessionInfo?.attendance && typeof sessionInfo === 'object' && Object.keys(sessionInfo).length > 0 && !sessionInfo.paid_hours;
  const attendance = hasSession ? (isOldFormat ? sessionInfo : (sessionInfo?.attendance || {})) : {};
  const isCancelled = sessionInfo && (sessionInfo.cancelled || sessionInfo.paid_hours === 0);
  
  console.log('hasSession:', hasSession);
  console.log('sessionInfo:', sessionInfo);
  console.log('isCancelled:', isCancelled);
  console.log('attendance:', attendance);
  if (hasSession) {
    console.log('currentSessions[dateKey]:', currentSessions[dateKey]);
  }
  
  try {
    if (hasSession && !isCancelled) {
      // 有 session 且未取消：取消標記
      console.log('取消標記流程 - attendance:', attendance);
      console.log('attendance keys:', Object.keys(attendance));
      console.log('attendance length:', Object.keys(attendance).length);
      
      if (Object.keys(attendance).length === 0) {
        // 如果 attendance 是空的，可以刪除或標記為已取消
        const sessionId = `${dateKey}_${currentClassId}`;
        const sessionRef = doc(db, 'sessions', sessionId);
        
        if (isScheduled) {
          // 如果是預定上課日，標記為已取消（paid_hours: 0）而不是刪除
          console.log('預定上課日，標記為已取消');
          const dateTimestamp = new Date(dateKey + 'T00:00:00');
          await setDoc(sessionRef, {
            date: dateTimestamp,
            class_id: currentClassId,
            paid_hours: 0,
            attendance: {},
            cancelled: true,
            updated_at: serverTimestamp()
          }, { merge: true });
          
          currentSessions[dateKey] = {
            attendance: {},
            paid_hours: 0,
            cancelled: true
          };
          showMessage('✓ 已取消預定上課日標記', 'success');
        } else {
          // 如果不是預定上課日，直接刪除 session
          console.log('準備刪除 session:', sessionId);
          await deleteDoc(sessionRef);
          console.log('✓ 刪除成功');
          
          delete currentSessions[dateKey];
          showMessage('✓ 已取消標記', 'success');
        }
      } else {
        // 如果有學生記錄，不能刪除 session
        console.log('此日期已有學生出缺席記錄，無法取消標記');
        alert('此日期已有學生出缺席記錄，無法取消標記');
        return;
      }
    } else if (isScheduled) {
      // 沒有 session 但是預定上課日：取消預定標記（創建一個 paid_hours: 0 的 session 來記錄「已取消」）
      if (!confirm(`確定要取消 ${dateKey} 這天的預定上課日標記嗎？\n（例如：國定假日、公司通知休假等）`)) {
        return;
      }
      
      const sessionId = `${dateKey}_${currentClassId}`;
      const sessionRef = doc(db, 'sessions', sessionId);
      const dateTimestamp = new Date(dateKey + 'T00:00:00');
      
      console.log('取消預定上課日標記 - 準備創建 paid_hours: 0 的 session');
      console.log('sessionId:', sessionId);
      console.log('dateTimestamp:', dateTimestamp);
      
      // 創建一個 paid_hours: 0 的 session 來記錄「已取消的預定上課日」
      await setDoc(sessionRef, {
        date: dateTimestamp,
        class_id: currentClassId,
        paid_hours: 0,  // 0 表示已取消，不計入請款
        attendance: {},
        cancelled: true,  // 標記為已取消
        updated_at: serverTimestamp()
      });
      
      console.log('✓ 已創建取消標記的 session');
      
      // 更新本地狀態（標記為已取消，但 hasSession 會是 true，所以不會顯示綠色）
      currentSessions[dateKey] = {
        attendance: {},
        paid_hours: 0,
        cancelled: true
      };
      
      showMessage('✓ 已取消預定上課日標記', 'success');
    } else if (hasSession && isCancelled) {
      // 有 session 但已取消：恢復標記
      if (!confirm(`確定要恢復 ${dateKey} 這天的標記嗎？`)) {
        return;
      }
      
      const sessionId = `${dateKey}_${currentClassId}`;
      const sessionRef = doc(db, 'sessions', sessionId);
      const dateTimestamp = new Date(dateKey + 'T00:00:00');
      
      console.log('恢復標記 - 準備更新 session');
      await setDoc(sessionRef, {
        date: dateTimestamp,
        class_id: currentClassId,
        paid_hours: 1,
        attendance: attendance,
        cancelled: false,
        updated_at: serverTimestamp()
      }, { merge: true });
      
      currentSessions[dateKey] = {
        attendance: attendance,
        paid_hours: 1,
        cancelled: false
      };
      
      showMessage('✓ 已恢復標記', 'success');
    } else {
      // 標記：創建空的 session
      const sessionId = `${dateKey}_${currentClassId}`;
      const sessionRef = doc(db, 'sessions', sessionId);
      const dateTimestamp = new Date(dateKey + 'T00:00:00');
      
      console.log('標記流程 - 準備創建 session');
      console.log('sessionId:', sessionId);
      console.log('dateTimestamp:', dateTimestamp);
      console.log('sessionRef:', sessionRef);
      
      // 檢查是否已存在（避免重複創建）
      console.log('檢查 session 是否已存在...');
      const existingDoc = await getDoc(sessionRef);
      console.log('existingDoc.exists():', existingDoc.exists());
      
      if (existingDoc.exists()) {
        console.log('Session 已存在，檢查 attendance');
        const existingData = existingDoc.data();
        console.log('existingData:', existingData);
        console.log('existingData.attendance:', existingData.attendance);
        
        if (!existingData.attendance || Object.keys(existingData.attendance).length === 0) {
          console.log('更新現有 session（attendance 為空）');
          const updateData = {
            date: dateTimestamp,
            class_id: currentClassId,
            paid_hours: 1,
            attendance: {},
            updated_at: serverTimestamp()
          };
          console.log('updateData:', updateData);
          
          await setDoc(sessionRef, updateData, { merge: true });
          console.log('✓ 更新成功');
        } else {
          console.log('Session 已存在且有 attendance，不執行操作');
          console.log('attendance keys:', Object.keys(existingData.attendance));
          showMessage('✓ 此日期已有記錄', 'success');
          return;
        }
      } else {
        console.log('創建新 session');
        const newData = {
          date: dateTimestamp,
          class_id: currentClassId,
          paid_hours: 1,
          attendance: {}, // 空的 attendance
          updated_at: serverTimestamp()
        };
        console.log('newData:', newData);
        
        await setDoc(sessionRef, newData);
        console.log('✓ 創建成功');
      }
      
      // 驗證寫入是否成功
      console.log('驗證寫入是否成功...');
      const verifyDoc = await getDoc(sessionRef);
      if (!verifyDoc.exists()) {
        throw new Error('寫入後驗證失敗：session 不存在於 Firestore');
      }
      console.log('✓ 驗證成功，session 已存在於 Firestore');
      console.log('驗證的 session 資料:', verifyDoc.data());
      
      // 更新本地狀態
      currentSessions[dateKey] = {
        attendance: {},
        paid_hours: 1,
        cancelled: false
      };
      console.log('更新本地狀態完成');
      showMessage('✓ 已標記老師出席', 'success');
    }
    
    // 重新載入 sessions 以確保同步
    console.log('重新載入 sessions...');
    await loadSessions();
    console.log('重新載入完成，currentSessions:', currentSessions);
    
    // 標記老師出席是直接寫入 Firestore，所以不需要 pending changes
    // 但如果有學生出缺席變更，還是需要「儲存變更」按鈕
    // 所以這裡不改變 pendingChanges 的狀態
    // saveCalendarBtn 的狀態也不改變（保持原樣）
    
    // 重新渲染以更新視覺標記
    console.log('重新渲染月曆...');
    try {
      renderCalendar();
      console.log('✓ 月曆渲染完成');
    } catch (renderError) {
      console.error('渲染月曆失敗:', renderError);
      showMessage('✗ 渲染失敗，請重新整理頁面', 'error');
    }
    console.log('=== 處理完成 ===');
    
  } catch (error) {
    console.error('=== 標記失敗 - 完整錯誤資訊 ===');
    console.error('錯誤物件:', error);
    console.error('錯誤類型:', error.constructor.name);
    console.error('錯誤代碼:', error.code);
    console.error('錯誤訊息:', error.message);
    console.error('錯誤堆疊:', error.stack);
    
    if (error.code) {
      console.error('Firestore 錯誤代碼:', error.code);
      if (error.code === 'permission-denied') {
        console.error('權限被拒絕！請檢查 Firestore security rules');
      } else if (error.code === 'unavailable') {
        console.error('Firestore 服務不可用，請檢查網路連線');
      }
    }
    
    const errorMsg = error.message || error.code || '未知錯誤';
    showMessage(`✗ 標記失敗: ${errorMsg}`, 'error');
    console.error('=== 錯誤處理完成 ===');
  }
}

// 處理儲存
async function handleSave() {
  if (!currentClassId) return;
  
  try {
    saveCalendarBtn.disabled = true;
    saveCalendarBtn.textContent = '儲存中...';
    
    // 遍歷所有有記錄的日期
    for (const [dateKey, sessionInfo] of Object.entries(currentSessions)) {
      const sessionId = `${dateKey}_${currentClassId}`;
      const sessionRef = doc(db, 'sessions', sessionId);
      
      // 轉換日期字串為 timestamp
      const dateTimestamp = new Date(dateKey + 'T00:00:00');
      
      // 如果 sessionInfo 是舊格式（直接是 attendance），轉換為新格式
      const attendance = sessionInfo?.attendance || (typeof sessionInfo === 'object' && !sessionInfo.attendance ? sessionInfo : {});
      const paid_hours = sessionInfo?.paid_hours || 1;
      const cancelled = sessionInfo?.cancelled || false;
      
      await setDoc(sessionRef, {
        date: dateTimestamp,
        class_id: currentClassId,
        paid_hours: paid_hours,
        attendance: attendance,
        cancelled: cancelled,
        updated_at: serverTimestamp()
      }, { merge: true });
    }
    
    pendingChanges = false;
    saveCalendarBtn.disabled = true;
    saveCalendarBtn.textContent = '儲存變更';
    unsavedWarning.style.display = 'none';
    
    // 顯示成功訊息
    showMessage('✓ 已儲存', 'success');
    
  } catch (error) {
    console.error('儲存失敗:', error);
    showMessage('✗ 儲存失敗，請重試', 'error');
    saveCalendarBtn.disabled = false;
    saveCalendarBtn.textContent = '儲存變更';
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
  if (!currentClassId || currentStudents.length === 0) {
    progressTextCalendar.textContent = '已完成: 0 / 0';
    return;
  }
  
  let totalCells = 0;
  let completedCells = 0;
  
  const [year, month] = currentMonthValue.split('-');
  const daysInMonth = new Date(year, month, 0).getDate();
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    if (!isWeekend) {
      totalCells += currentStudents.length;
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const session = currentSessions[dateKey];
      if (session) {
        completedCells += Object.keys(session).length;
      }
    }
  }
  
  progressTextCalendar.textContent = `已完成: ${completedCells} / ${totalCells}`;
}

// 啟動
init();


// viewer.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  orderBy
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig } from './config.js';

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM 元素
const monthSelect = document.getElementById('month-select');
const classSelectViewer = document.getElementById('class-select-viewer');
const exportExcelBtn = document.getElementById('export-excel-btn');
const executiveSummarySection = document.getElementById('executive-summary-section');
const studentListSection = document.getElementById('student-list-section');
const detailedTablesSection = document.getElementById('detailed-tables-section');

// 設定預設月份為當前月份
const now = new Date();
monthSelect.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// 狀態
let allClasses = [];
let allSessions = [];

// 初始化
async function init() {
  await loadClasses();
  await loadSessions();
  renderTables();
  
  // 監聽事件
  monthSelect.addEventListener('change', handleMonthChange);
  classSelectViewer.addEventListener('change', handleClassChange);
  exportExcelBtn.addEventListener('click', handleExportExcel);
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
        hourRate: doc.data().hour_rate || 400,
        classDays: doc.data().class_days || [1, 2, 3, 4, 5] // 預設每天上課
      });
    });
    
    // 更新下拉選單（僅班級，無「全部」；學生畫面只顯示單班）
    classSelectViewer.innerHTML = '';
    allClasses.forEach(cls => {
      const option = document.createElement('option');
      option.value = cls.id;
      option.textContent = cls.name;
      classSelectViewer.appendChild(option);
    });
    if (allClasses.length > 0) {
      classSelectViewer.value = allClasses[0].id;
    }
  } catch (error) {
    console.error('Failed to load classes:', error);
  }
}

// 載入 sessions
async function loadSessions() {
  try {
    const selectedMonth = monthSelect.value;
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

// 處理月份變更
async function handleMonthChange() {
  await loadSessions();
  renderTables();
}

// 處理班級變更
function handleClassChange() {
  renderTables();
}

// 渲染整個畫面（單班：Executive Summary 無費用 + 學生列表 + 詳細出席表）
async function renderTables() {
  const selectedClassId = classSelectViewer.value;
  
  if (!selectedClassId || allClasses.length === 0) {
    executiveSummarySection.innerHTML = '<div class="empty-state">請選擇班級</div>';
    studentListSection.innerHTML = '';
    detailedTablesSection.innerHTML = '';
    return;
  }
  
  const classData = allClasses.find(c => c.id === selectedClassId);
  if (!classData) {
    executiveSummarySection.innerHTML = '<div class="empty-state">班級不存在</div>';
    studentListSection.innerHTML = '';
    detailedTablesSection.innerHTML = '';
    return;
  }
  
  executiveSummarySection.innerHTML = '<div class="loading">載入中...</div>';
  studentListSection.innerHTML = '';
  detailedTablesSection.innerHTML = '';
  
  const classSessions = allSessions.filter(s => s.class_id === classData.id);
  
  if (classSessions.length === 0) {
    executiveSummarySection.innerHTML = '<div class="empty-state">此月份尚無出勤記錄</div>';
    studentListSection.innerHTML = '';
    detailedTablesSection.innerHTML = '<div class="empty-state">此月份尚無出勤記錄</div>';
    return;
  }
  
  // 建立 sessionMap（僅 paid 且未取消）
  const sessionMap = {};
  classSessions.forEach(session => {
    const paidHours = session.paid_hours !== undefined ? session.paid_hours : 1;
    const isCancelled = session.cancelled || paidHours === 0;
    if (!isCancelled) {
      const date = session.date.toDate();
      const dateKey = date.toISOString().split('T')[0];
      sessionMap[dateKey] = session.attendance || {};
    }
  });
  
  const scheduledDays = Object.keys(sessionMap).length;
  const totalHours = scheduledDays; // 老師出席天數 = 該班當月 session 數
  
  // 載入該班學生並計算每人 Attendance %、Engagement %
  const studentsRef = collection(db, `classes/${classData.id}/students`);
  const studentsSnapshot = await getDocs(query(studentsRef, where('active', '==', true)));
  const students = [];
  studentsSnapshot.forEach(doc => {
    students.push({
      id: doc.id,
      name: doc.data().name
    });
  });
  students.sort((a, b) => a.name.localeCompare(b.name));
  
  const studentsWithRates = students.map(student => {
    let totalPresent = 0, totalLeave = 0;
    Object.keys(sessionMap).forEach(dateKey => {
      const att = sessionMap[dateKey][student.id];
      if (att === '1') totalPresent++;
      else if (att === 'i') totalLeave++;
    });
    const attendanceRate = scheduledDays > 0 ? Math.round((totalPresent / scheduledDays) * 100) : 0;
    const engagementRate = scheduledDays > 0 ? Math.round(((totalPresent + totalLeave) / scheduledDays) * 100) : 0;
    return {
      ...student,
      attendanceRate,
      engagementRate
    };
  });
  
  const avgEngagementByStudent = studentsWithRates.length > 0
    ? Math.round(studentsWithRates.reduce((sum, s) => sum + s.engagementRate, 0) / studentsWithRates.length)
    : 0;
  const avgEngagementByClass = avgEngagementByStudent; // 單班時相同
  
  // 1. Executive Summary（無 Total Fee）
  executiveSummarySection.innerHTML = `
    <div class="summary-section-title">Executive Summary</div>
    <div class="overall-snapshot">
      <h3>Overall Snapshot</h3>
      <div class="snapshot-grid">
        <div class="snapshot-item">
          <div class="snapshot-label">Total Hours</div>
          <div class="snapshot-value">${totalHours}</div>
        </div>
        <div class="snapshot-item">
          <div class="snapshot-label">Overall Avg. Engagement (by Class)</div>
          <div class="snapshot-value">${avgEngagementByClass}%</div>
        </div>
        <div class="snapshot-item">
          <div class="snapshot-label">Overall Avg. Engagement (by Student)</div>
          <div class="snapshot-value">${avgEngagementByStudent}%</div>
        </div>
      </div>
    </div>
  `;
  
  // 2. 該班每人一行：姓名 + Attendance %、Engagement %
  studentListSection.innerHTML = `
    <h3 class="student-list-title">Student Insights</h3>
    <table class="student-list-table">
      <thead>
        <tr><th>Name</th><th>Attendance %</th><th>Engagement %</th></tr>
      </thead>
      <tbody>
        ${studentsWithRates.map(s => `
          <tr>
            <td class="student-name-cell">${s.name}</td>
            <td>${s.attendanceRate}%</td>
            <td>${s.engagementRate}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  // 3. 該班詳細出席表（含老師出席列）
  detailedTablesSection.innerHTML = await renderClassTable(classData, sessionMap, students);
  
  const tables = detailedTablesSection.querySelectorAll('.attendance-table');
  tables.forEach(table => table.classList.add('hide-week-total'));
}

// 渲染單一班級表格（可傳入已算好的 sessionMap、students 以避免重複查詢）
async function renderClassTable(classData, sessionMapFromParent, studentsFromParent) {
  let sessionMap = sessionMapFromParent;
  let students = studentsFromParent;
  const classSessions = allSessions.filter(s => s.class_id === classData.id);
  
  if (classSessions.length === 0) {
    return `
      <div class="class-table-section">
        <h2 class="class-table-title">${classData.name}</h2>
        <div class="empty-state">No records for this month</div>
      </div>
    `;
  }
  
  if (!students || !sessionMap) {
    const studentsRef = collection(db, `classes/${classData.id}/students`);
    const studentsSnapshot = await getDocs(query(studentsRef, where('active', '==', true)));
    students = [];
    studentsSnapshot.forEach(doc => {
      students.push({
        id: doc.id,
        name: doc.data().name
      });
    });
    students.sort((a, b) => a.name.localeCompare(b.name));
    
    sessionMap = {};
    classSessions.forEach(session => {
      const paidHours = session.paid_hours !== undefined ? session.paid_hours : 1;
      const isCancelled = session.cancelled || paidHours === 0;
      if (!isCancelled) {
        const date = session.date.toDate();
        const dateKey = date.toISOString().split('T')[0];
        sessionMap[dateKey] = session.attendance || {};
      }
    });
  }
  
  // 取得該月份的所有日期（固定從週一開始，顯示完整週曆）
  const selectedMonth = monthSelect.value;
  const [year, month] = selectedMonth.split('-');
  const daysInMonth = new Date(year, month, 0).getDate();
  const classDays = classData.classDays || [1, 2, 3, 4, 5]; // 預設每天上課，1=週一, 2=週二, ..., 7=週日
  
  // 找到該月份第一個週一
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const firstDayWeekday = firstDayOfMonth.getDay(); // 0=週日, 1=週一, ..., 6=週六
  // 計算到第一個週一需要倒退幾天（如果1號不是週一）
  const daysToFirstMonday = firstDayWeekday === 0 ? 6 : firstDayWeekday - 1;
  const firstMonday = new Date(year, month - 1, 1 - daysToFirstMonday);
  
  // 建立完整週曆（從第一個週一開始，到最後一個週日結束）
  const dates = [];
  let currentDate = new Date(firstMonday);
  const lastDayOfMonth = new Date(year, month, 0);
  
  // 計算最後一個週日
  const lastDayWeekday = lastDayOfMonth.getDay(); // 0=週日, 1=週一, ..., 6=週六
  const daysToLastSunday = lastDayWeekday === 0 ? 0 : 7 - lastDayWeekday;
  const lastSunday = new Date(year, month - 1, lastDayOfMonth.getDate() + daysToLastSunday);
  
  // 從第一個週一到最後一個週日，建立所有日期
  while (currentDate <= lastSunday) {
    const dayOfWeek = currentDate.getDay();
    const adjustedDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek; // 轉換為 1=週一, ..., 7=週日
    const weekdayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dayOfWeek];
    const isInMonth = currentDate.getMonth() === month - 1;
    const isClassDay = classDays.includes(adjustedDayOfWeek);
    
    dates.push({
      date: new Date(currentDate),
      dateKey: currentDate.toISOString().split('T')[0],
      day: currentDate.getDate(),
      dayOfWeek: weekdayAbbr,
      adjustedDayOfWeek: adjustedDayOfWeek,
      isInMonth: isInMonth,
      isClassDay: isClassDay
    });
    
    // 移到下一天
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // 分組為真正的週（每週7天，週一到週日）
  const weeks = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7));
  }
  
  // 建立表格 HTML
  let tableHtml = `
    <div class="class-table-section">
      <div class="class-table-header">
        <h2 class="class-table-title">${classData.name}</h2>
        <button class="toggle-week-total-btn" title="Toggle Week Total columns" onclick="toggleWeekTotal(this)">
          <span class="toggle-text">Show Week Total</span>
        </button>
      </div>
      <table class="attendance-table">
        <thead>
          <tr class="header-row-date">
            <th class="student-name" rowspan="2">Name</th>
  `;
  
  // 第一行表頭：日期
  weeks.forEach((week, weekIndex) => {
    week.forEach(dateInfo => {
      const isInMonth = dateInfo.isInMonth;
      const isClassDay = dateInfo.isClassDay;
      const cellClass = !isInMonth ? 'non-month-day' : (!isClassDay ? 'non-class-day' : '');
      tableHtml += `<th class="${cellClass}">${isInMonth ? dateInfo.day : ''}</th>`;
    });
    tableHtml += `<th class="week-total collapsible tooltip-header" rowspan="2" data-title="Week Total">W.T.</th>`;
  });
  
  tableHtml += `
            <th class="month-total tooltip-header" rowspan="2" data-title="Hours">Hrs</th>
            <th class="month-total tooltip-header" rowspan="2" data-title="Scheduled">Sch.</th>
            <th class="month-total tooltip-header" rowspan="2" data-title="Attendance Rate: (Present) / (Scheduled)">Att.</th>
            <th class="month-total tooltip-header" rowspan="2" data-title="Engagement Rate: (Present + Leave) / (Scheduled)">Eng.</th>
          </tr>
          <tr class="header-row-weekday">
  `;
  
  // 第二行表頭：星期
  weeks.forEach(week => {
    week.forEach(dateInfo => {
      const isInMonth = dateInfo.isInMonth;
      const isClassDay = dateInfo.isClassDay;
      const cellClass = !isInMonth ? 'non-month-day' : (!isClassDay ? 'non-class-day' : '');
      tableHtml += `<th class="${cellClass}">${dateInfo.dayOfWeek}</th>`;
    });
  });
  
  tableHtml += `
          </tr>
        </thead>
        <tbody>
  `;
  
  const scheduledDays = Object.keys(sessionMap).length;
  
  // 老師出席列
  tableHtml += `<tr class="row-teacher"><td class="student-name">Teacher</td>`;
  weeks.forEach(week => {
    let weekTeacherDays = 0;
    week.forEach(dateInfo => {
      if (!dateInfo.isInMonth) {
        tableHtml += `<td class="non-month-day"></td>`;
        return;
      }
      if (!dateInfo.isClassDay) {
        tableHtml += `<td class="non-class-day">-</td>`;
        return;
      }
      const hasTeacher = sessionMap[dateInfo.dateKey] != null;
      if (hasTeacher) {
        weekTeacherDays++;
        tableHtml += `<td class="status-teacher" title="Teacher present">✓</td>`;
      } else {
        tableHtml += `<td>-</td>`;
      }
    });
    tableHtml += `<td class="week-total collapsible">${weekTeacherDays}</td>`;
  });
  tableHtml += `<td class="month-total">${scheduledDays}</td><td class="month-total">${scheduledDays}</td><td class="month-total">-</td><td class="month-total">-</td></tr>`;
  
  // 學生列
  students.forEach(student => {
    tableHtml += `<tr><td class="student-name">${student.name}</td>`;
    
    let totalHours = 0;
    let totalLeave = 0;
    
    weeks.forEach(week => {
      let weekTotal = 0;
      
      week.forEach(dateInfo => {
        const isInMonth = dateInfo.isInMonth;
        const isClassDay = dateInfo.isClassDay;
        
        // 非當月日期：顯示空白
        if (!isInMonth) {
          tableHtml += `<td class="non-month-day"></td>`;
          return;
        }
        
        // 非上課天：顯示灰色背景
        if (!isClassDay) {
          tableHtml += `<td class="non-class-day">-</td>`;
          return;
        }
        
        // 上課天：顯示出缺席狀態
        const attendance = sessionMap[dateInfo.dateKey]?.[student.id];
        
        if (attendance === '1') {
          tableHtml += `<td class="status-present">v</td>`;
          weekTotal++;
          totalHours++;
        } else if (attendance === 'x') {
          tableHtml += `<td class="status-absent">x</td>`;
        } else if (attendance === 'i') {
          tableHtml += `<td class="status-leave">i</td>`;
          totalLeave++;
        } else {
          tableHtml += `<td>-</td>`;
        }
      });
      
      tableHtml += `<td class="week-total collapsible">${weekTotal}</td>`;
    });
    
    // 出席率 = 學生出席時數 / 預定時數（老師實際出席天數）
    const attendanceRate = scheduledDays > 0 
      ? Math.round((totalHours / scheduledDays) * 100) 
      : 0;
    
    // Engagement Rate = (出席 + 請假) / 預定時數
    const engagementRate = scheduledDays > 0 
      ? Math.round(((totalHours + totalLeave) / scheduledDays) * 100) 
      : 0;
    
    // 每個學生的 Scheduled = 老師出席的天數（鐘點數）
    tableHtml += `
      <td class="month-total">${totalHours}</td>
      <td class="month-total">${scheduledDays}</td>
      <td class="month-total">${attendanceRate}%</td>
      <td class="month-total">${engagementRate}%</td>
    </tr>`;
  });
  
  // 總計列
  tableHtml += `<tr class="month-total"><td class="student-name">Total</td>`;
  
  let classTotalHours = 0;
  let classTotalLeave = 0;
  
  weeks.forEach(week => {
    let weekTotal = 0;
    
    week.forEach(dateInfo => {
      const isInMonth = dateInfo.isInMonth;
      const isClassDay = dateInfo.isClassDay;
      
      // 非當月日期或非上課天：顯示空白或灰色
      if (!isInMonth) {
        tableHtml += `<td class="non-month-day"></td>`;
        return;
      }
      
      if (!isClassDay) {
        tableHtml += `<td class="non-class-day"></td>`;
        return;
      }
      
      // 上課天：計算出席總數和請假總數
      const session = sessionMap[dateInfo.dateKey];
      if (session) {
        const presentCount = Object.values(session).filter(s => s === '1').length;
        const leaveCount = Object.values(session).filter(s => s === 'i').length;
        weekTotal += presentCount;
        classTotalHours += presentCount;
        classTotalLeave += leaveCount;
      }
      tableHtml += `<td></td>`;
    });
    
    tableHtml += `<td class="week-total collapsible">${weekTotal}</td>`;
  });
  
  // 總計出席率 = 所有學生出席時數總和 / (預定時數 × 學生數量)
  const totalScheduledHours = scheduledDays * students.length;
  const classAttendanceRate = totalScheduledHours > 0
    ? Math.round((classTotalHours / totalScheduledHours) * 100)
    : 0;
  
  // 總計 Engagement Rate = (所有學生出席總數 + 所有學生請假總數) / (預定時數 × 學生數量)
  const classEngagementRate = totalScheduledHours > 0
    ? Math.round(((classTotalHours + classTotalLeave) / totalScheduledHours) * 100)
    : 0;
  
  // 總計行的 Scheduled = 老師出席的天數（鐘點數）× 學生人數
  const totalScheduledForDisplay = scheduledDays * students.length;
  tableHtml += `
    <td class="month-total">${classTotalHours}</td>
    <td class="month-total">${totalScheduledForDisplay}</td>
    <td class="month-total">${classAttendanceRate}%</td>
    <td class="month-total">${classEngagementRate}%</td>
  </tr>`;
  
  tableHtml += `
        </tbody>
      </table>
    </div>
  `;
  
  return tableHtml;
}

// 匯出 Excel
async function handleExportExcel() {
  // 動態載入 xlsx 庫
  const script = document.createElement('script');
  script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
  script.onload = async () => {
    await exportToExcel();
  };
  document.head.appendChild(script);
}

async function exportToExcel() {
  const selectedMonth = monthSelect.value;
  const selectedClassId = classSelectViewer.value;
  const classesToExport = selectedClassId
    ? allClasses.filter(c => c.id === selectedClassId)
    : [];
  
  const workbook = XLSX.utils.book_new();
  
  for (const classData of classesToExport) {
    const classSessions = allSessions.filter(s => s.class_id === classData.id);
    if (classSessions.length === 0) continue;
    
    // 取得學生列表
    const studentsRef = collection(db, `classes/${classData.id}/students`);
    const studentsSnapshot = await getDocs(query(studentsRef, where('active', '==', true)));
    
    const students = [];
    studentsSnapshot.forEach(doc => {
      students.push({
        id: doc.id,
        name: doc.data().name
      });
    });
    
    students.sort((a, b) => a.name.localeCompare(b.name));
    
    // 建立資料陣列（固定從週一開始，顯示完整週曆，與網頁顯示一致）
    const [year, month] = selectedMonth.split('-');
    const daysInMonth = new Date(year, month, 0).getDate();
    const classDays = classData.classDays || [1, 2, 3, 4, 5]; // 預設每天上課，1=週一, 2=週二, ..., 7=週日
    
    // 找到該月份第一個週一
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const firstDayWeekday = firstDayOfMonth.getDay();
    const daysToFirstMonday = firstDayWeekday === 0 ? 6 : firstDayWeekday - 1;
    const firstMonday = new Date(year, month - 1, 1 - daysToFirstMonday);
    
    // 建立完整週曆
    const dates = [];
    let currentDate = new Date(firstMonday);
    const lastDayOfMonth = new Date(year, month, 0);
    const lastDayWeekday = lastDayOfMonth.getDay();
    const daysToLastSunday = lastDayWeekday === 0 ? 0 : 7 - lastDayWeekday;
    const lastSunday = new Date(year, month - 1, lastDayOfMonth.getDate() + daysToLastSunday);
    
    while (currentDate <= lastSunday) {
      const dayOfWeek = currentDate.getDay();
      const adjustedDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
      const weekdayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dayOfWeek];
      const isInMonth = currentDate.getMonth() === month - 1;
      const isClassDay = classDays.includes(adjustedDayOfWeek);
      
      dates.push({
        date: new Date(currentDate),
        dateKey: currentDate.toISOString().split('T')[0],
        day: currentDate.getDate(),
        dayOfWeek: weekdayAbbr,
        adjustedDayOfWeek: adjustedDayOfWeek,
        isInMonth: isInMonth,
        isClassDay: isClassDay
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    const sessionMap = {};
    classSessions.forEach(session => {
      // 只包含老師實際出席的 session（paid_hours: 1）
      // 排除已取消的 session（paid_hours: 0 或 cancelled: true）
      const paidHours = session.paid_hours !== undefined ? session.paid_hours : 1; // 舊資料可能沒有 paid_hours，預設為 1
      const isCancelled = session.cancelled || paidHours === 0;
      
      if (!isCancelled) {
        const date = session.date.toDate();
        const dateKey = date.toISOString().split('T')[0];
        sessionMap[dateKey] = session.attendance || {};
      }
    });
    
    // 計算老師實際出席天數（預定時數）
    // 預定時數 = 該月份該班級有 paid_hours: 1 的 sessions 的日期數量（排除已取消的 session）
    const scheduledDays = Object.keys(sessionMap).length;
    
    // 分組為真正的週（每週7天，週一到週日）
    const weeks = [];
    for (let i = 0; i < dates.length; i += 7) {
      weeks.push(dates.slice(i, i + 7));
    }
    
    // 建立 Excel 資料
    const excelData = [];
    
    // 第一行標題：日期
    const headerDate = ['Name'];
    weeks.forEach(week => {
      week.forEach(d => {
        if (d.isInMonth) {
          headerDate.push(d.day);
        } else {
          headerDate.push('');
        }
      });
      headerDate.push('Week Total');
    });
    headerDate.push('Total Hours', 'Scheduled Hours', 'Attendance Rate', 'Engagement Rate');
    excelData.push(headerDate);
    
    // 第二行標題：星期
    const headerWeekday = [''];
    weeks.forEach(week => {
      week.forEach(d => {
        if (d.isInMonth) {
          headerWeekday.push(d.dayOfWeek);
        } else {
          headerWeekday.push('');
        }
      });
      headerWeekday.push('');
    });
    headerWeekday.push('', '', '', '');
    excelData.push(headerWeekday);
    
    // 學生資料列
    students.forEach(student => {
      const row = [student.name];
      let totalHours = 0;
      let totalLeave = 0;
      
      weeks.forEach(week => {
        let weekTotal = 0;
        
        week.forEach(dateInfo => {
          // 非當月日期：留空
          if (!dateInfo.isInMonth) {
            row.push('');
            return;
          }
          
          // 非上課天：顯示 '-'
          if (!dateInfo.isClassDay) {
            row.push('-');
            return;
          }
          
          // 上課天：顯示出缺席狀態
          const attendance = sessionMap[dateInfo.dateKey]?.[student.id];
          
          if (attendance === '1') {
            row.push(1); // Excel 中用 1 表示出席
            weekTotal++;
            totalHours++;
          } else if (attendance === 'x') {
            row.push('x');
          } else if (attendance === 'i') {
            row.push('i');
            totalLeave++;
          } else {
            row.push('');
          }
        });
        
        row.push(weekTotal);
      });
      
      // 出席率 = 學生出席時數 / 預定時數（老師實際出席天數）
      const attendanceRate = scheduledDays > 0 
        ? Math.round((totalHours / scheduledDays) * 100) 
        : 0;
      
      // Engagement Rate = (出席 + 請假) / 預定時數
      const engagementRate = scheduledDays > 0 
        ? Math.round(((totalHours + totalLeave) / scheduledDays) * 100) 
        : 0;
      
      row.push(totalHours, scheduledDays, `${attendanceRate}%`, `${engagementRate}%`);
      excelData.push(row);
    });
    
    // 建立工作表
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);
    XLSX.utils.book_append_sheet(workbook, worksheet, classData.name.substring(0, 31));
  }
  
  // 下載檔案
  const fileName = `Attendance_Overview_${selectedMonth}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}

// 切換 Week Total 顯示/隱藏
function toggleWeekTotal(button) {
  const tables = document.querySelectorAll('.attendance-table');
  const isHidden = tables.length > 0 && tables[0].classList.contains('hide-week-total');
  
  tables.forEach(table => {
    if (isHidden) {
      table.classList.remove('hide-week-total');
    } else {
      table.classList.add('hide-week-total');
    }
  });
  
  // 更新按鈕文字
  const toggleTexts = document.querySelectorAll('.toggle-text');
  toggleTexts.forEach(text => {
    text.textContent = isHidden ? 'Show Week Total' : 'Hide Week Total';
  });
}

// 將函數暴露到全局，以便 HTML onclick 可以調用
window.toggleWeekTotal = toggleWeekTotal;

// 啟動
init();


// viewer-rh.js - HR Performance Report
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
const monthSelectRh = document.getElementById('month-select-rh');
const exportExcelBtnRh = document.getElementById('export-excel-btn-rh');
const monthYearDisplay = document.getElementById('month-year-display');
const executiveSummary = document.getElementById('executive-summary');
const studentInsights = document.getElementById('student-insights');
const detailedTables = document.getElementById('detailed-tables');

// 設定預設月份為當前月份
const now = new Date();
monthSelectRh.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
updateMonthYearDisplay();

// 老師資訊
const teacherInfo = {
  name: 'Elisa Chang',
  hourRate: 400
};

// 狀態
let allClasses = [];
let allSessions = [];
let allStudentsData = []; // 儲存所有學生的詳細數據

// 初始化
async function init() {
  await loadClasses();
  await loadSessions();
  await loadAllStudentsData();
  renderAll();
  
  // 監聽事件
  monthSelectRh.addEventListener('change', handleMonthChange);
  exportExcelBtnRh.addEventListener('click', handleExportExcel);
}

// 更新月份顯示
function updateMonthYearDisplay() {
  const selectedMonth = monthSelectRh.value;
  if (selectedMonth) {
    const [year, month] = selectedMonth.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    monthYearDisplay.textContent = `${monthNames[parseInt(month) - 1]} ${year}`;
  }
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
        classDays: doc.data().class_days || [1, 2, 3, 4, 5]
      });
    });
  } catch (error) {
    console.error('Failed to load classes:', error);
  }
}

// 載入 sessions
async function loadSessions() {
  try {
    const selectedMonth = monthSelectRh.value;
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

// 載入所有學生的詳細數據
async function loadAllStudentsData() {
  allStudentsData = [];
  
  for (const classData of allClasses) {
    try {
      const studentsRef = collection(db, `classes/${classData.id}/students`);
      const studentsSnapshot = await getDocs(query(studentsRef, where('active', '==', true)));
      
      const classSessions = allSessions.filter(s => s.class_id === classData.id);
      
      // 建立 sessionMap（只包含 paid_hours: 1 的 session）
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
      
      studentsSnapshot.forEach(doc => {
        const student = {
          id: doc.id,
          name: doc.data().name,
          classId: classData.id,
          className: classData.name
        };
        
        // 計算學生的出勤數據
        let totalPresent = 0; // Total 1s
        let totalLeave = 0;   // Total is
        let totalAbsent = 0;   // Total xs
        
        Object.keys(sessionMap).forEach(dateKey => {
          const attendance = sessionMap[dateKey][student.id];
          if (attendance === '1') {
            totalPresent++;
          } else if (attendance === 'i') {
            totalLeave++;
          } else if (attendance === 'x') {
            totalAbsent++;
          }
        });
        
        // 計算 Attendance Rate 和 Engagement Rate
        const attendanceRate = scheduledDays > 0 
          ? Math.round((totalPresent / scheduledDays) * 100) 
          : 0;
        
        const engagementRate = scheduledDays > 0 
          ? Math.round(((totalPresent + totalLeave) / scheduledDays) * 100) 
          : 0;
        
        student.totalPresent = totalPresent;
        student.totalLeave = totalLeave;
        student.totalAbsent = totalAbsent;
        student.scheduledDays = scheduledDays;
        student.attendanceRate = attendanceRate;
        student.engagementRate = engagementRate;
        
        allStudentsData.push(student);
      });
    } catch (error) {
      console.error(`Failed to load students for class ${classData.id}:`, error);
    }
  }
}

// 處理月份變更
async function handleMonthChange() {
  updateMonthYearDisplay();
  await loadSessions();
  await loadAllStudentsData();
  renderAll();
}

// 渲染所有內容
async function renderAll() {
  renderExecutiveSummary();
  renderStudentInsights();
  await renderDetailedTables();
}

// 渲染 Executive Summary
function renderExecutiveSummary() {
  if (allClasses.length === 0 || allSessions.length === 0) {
    executiveSummary.innerHTML = '<div class="empty-state">No data available</div>';
    return;
  }
  
  // 計算 Overall Snapshot
  let totalHours = 0;
  let totalFee = 0;
  const classEngagementRates = [];
  const studentEngagementRates = [];
  
  for (const classData of allClasses) {
    const classSessions = allSessions.filter(s => s.class_id === classData.id);
    
    // 計算該班級的老師實際出席時數
    let classHours = 0;
    classSessions.forEach(session => {
      const paidHours = session.paid_hours !== undefined ? session.paid_hours : 1;
      const isCancelled = session.cancelled || paidHours === 0;
      if (!isCancelled) {
        classHours++;
      }
    });
    
    totalHours += classHours;
    totalFee += classHours * classData.hourRate;
    
    // 計算該班級的 Engagement Rate
    const classStudents = allStudentsData.filter(s => s.classId === classData.id);
    if (classStudents.length > 0 && classHours > 0) {
      let classTotalEngagement = 0;
      classStudents.forEach(student => {
        classTotalEngagement += student.engagementRate;
        studentEngagementRates.push(student.engagementRate);
      });
      const classAvgEngagement = classTotalEngagement / classStudents.length;
      classEngagementRates.push(classAvgEngagement);
    }
  }
  
  // 計算 Overall Avg. Engagement
  const overallEngagementByClass = classEngagementRates.length > 0
    ? Math.round(classEngagementRates.reduce((a, b) => a + b, 0) / classEngagementRates.length)
    : 0;
  
  const overallEngagementByStudent = studentEngagementRates.length > 0
    ? Math.round(studentEngagementRates.reduce((a, b) => a + b, 0) / studentEngagementRates.length)
    : 0;
  
  // 計算 Class Summaries
  const classSummaries = [];
  for (const classData of allClasses) {
    const classStudents = allStudentsData.filter(s => s.classId === classData.id);
    const classSessions = allSessions.filter(s => s.class_id === classData.id);
    
    // 計算該班級的老師實際出席時數
    let classHours = 0;
    classSessions.forEach(session => {
      const paidHours = session.paid_hours !== undefined ? session.paid_hours : 1;
      const isCancelled = session.cancelled || paidHours === 0;
      if (!isCancelled) {
        classHours++;
      }
    });
    
    if (classStudents.length > 0 && classHours > 0) {
      // 計算該班級的平均 Attendance Rate 和 Engagement Rate
      let totalAttendanceRate = 0;
      let totalEngagementRate = 0;
      classStudents.forEach(student => {
        totalAttendanceRate += student.attendanceRate;
        totalEngagementRate += student.engagementRate;
      });
      
      const avgAttendanceRate = Math.round(totalAttendanceRate / classStudents.length);
      const avgEngagementRate = Math.round(totalEngagementRate / classStudents.length);
      
      // 決定 Status
      let status = '';
      let statusClass = '';
      if (avgEngagementRate >= 90) {
        status = 'Excellent participation.';
        statusClass = 'excellent';
      } else if (avgEngagementRate >= 60) {
        status = 'Stable attendance; curriculum on track.';
        statusClass = 'stable';
      } else {
        status = 'Requires attention/HR intervention.';
        statusClass = 'attention';
      }
      
      classSummaries.push({
        name: classData.name,
        attendanceRate: avgAttendanceRate,
        engagementRate: avgEngagementRate,
        status: status,
        statusClass: statusClass
      });
    }
  }
  
  // 渲染 HTML
  let html = `
    <div class="summary-section-title">Executive Summary</div>
    
    <div class="overall-snapshot">
      <h3>Overall Snapshot</h3>
      <div class="snapshot-grid">
        <div class="snapshot-item">
          <div class="snapshot-label">Total Hours</div>
          <div class="snapshot-value">${totalHours}</div>
        </div>
        <div class="snapshot-item">
          <div class="snapshot-label">Total Fee</div>
          <div class="snapshot-value">$${totalFee.toLocaleString()}</div>
        </div>
        <div class="snapshot-item">
          <div class="snapshot-label">Overall Avg. Engagement (by Class)</div>
          <div class="snapshot-value">${overallEngagementByClass}%</div>
        </div>
        <div class="snapshot-item">
          <div class="snapshot-label">Overall Avg. Engagement (by Student)</div>
          <div class="snapshot-value">${overallEngagementByStudent}%</div>
        </div>
      </div>
    </div>
    
    <div class="class-summaries">
      <h3>Class Summaries</h3>
      <div class="class-summaries-grid">
  `;
  
  classSummaries.forEach(summary => {
    html += `
      <div class="class-summary-card">
        <div class="class-summary-name">${summary.name}</div>
        <div class="class-summary-metrics">
          <div class="class-metric">
            <div class="class-metric-label">Attendance</div>
            <div class="class-metric-value">${summary.attendanceRate}%</div>
          </div>
          <div class="class-metric">
            <div class="class-metric-label">Engagement</div>
            <div class="class-metric-value">${summary.engagementRate}%</div>
          </div>
        </div>
        <div class="class-summary-status ${summary.statusClass}">
          ${summary.status}
        </div>
      </div>
    `;
  });
  
  html += `
      </div>
    </div>
  `;
  
  executiveSummary.innerHTML = html;
}

// 渲染 Student Insights
function renderStudentInsights() {
  // Top Performers: Engagement = 100%
  const topPerformers = allStudentsData.filter(s => s.engagementRate === 100);
  
  // Under Observation: Engagement < 50%
  const underObservation = allStudentsData.filter(s => s.engagementRate < 50);
  
  // 為 Under Observation 學生添加 Status 描述
  underObservation.forEach(student => {
    if (student.attendanceRate < 50 && student.engagementRate > 80) {
      student.status = 'High commitment despite workload constraints.';
    } else if (student.attendanceRate < 50 && student.engagementRate < 50) {
      student.status = 'Unexcused absences observed. Suggest resource review.';
    } else {
      student.status = 'Low engagement observed.';
    }
  });
  
  let html = `
    <h3>Student Insights</h3>
    <div class="insights-grid">
      <div class="insight-section">
        <div class="insight-section-title top-performers">
          ⭐ Top Performers (Engagement = 100%)
        </div>
        <ul class="student-list">
  `;
  
  if (topPerformers.length === 0) {
    html += '<li class="empty-state">No students with 100% engagement this month.</li>';
  } else {
    topPerformers.forEach(student => {
      html += `
        <li class="student-item top-performer">
          <div class="student-info">
            <div class="student-name">${student.name}</div>
            <div class="student-class">${student.className}</div>
          </div>
          <div class="student-metrics">
            <div class="student-metric">
              <div class="student-metric-label">Attendance</div>
              <div class="student-metric-value">${student.attendanceRate}%</div>
            </div>
            <div class="student-metric">
              <div class="student-metric-label">Engagement</div>
              <div class="student-metric-value">${student.engagementRate}%</div>
            </div>
          </div>
        </li>
      `;
    });
  }
  
  html += `
        </ul>
      </div>
      
      <div class="insight-section">
        <div class="insight-section-title under-observation">
          ⚠️ Under Observation (Engagement < 50%)
        </div>
        <ul class="student-list">
  `;
  
  if (underObservation.length === 0) {
    html += '<li class="empty-state">No students under observation this month.</li>';
  } else {
    underObservation.forEach(student => {
      html += `
        <li class="student-item under-observation">
          <div class="student-info">
            <div class="student-name">${student.name}</div>
            <div class="student-class">${student.className}</div>
            <div class="student-status">${student.status}</div>
          </div>
          <div class="student-metrics">
            <div class="student-metric">
              <div class="student-metric-label">Attendance</div>
              <div class="student-metric-value">${student.attendanceRate}%</div>
            </div>
            <div class="student-metric">
              <div class="student-metric-label">Engagement</div>
              <div class="student-metric-value">${student.engagementRate}%</div>
            </div>
          </div>
        </li>
      `;
    });
  }
  
  html += `
        </ul>
      </div>
    </div>
  `;
  
  studentInsights.innerHTML = html;
}

// 渲染詳細表格（重用 viewer.js 的邏輯，但移除編輯功能）
async function renderDetailedTables() {
  detailedTables.innerHTML = '<div class="loading">Loading...</div>';
  
  if (allClasses.length === 0 || allSessions.length === 0) {
    detailedTables.innerHTML = '<div class="empty-state">No data available</div>';
    return;
  }
  
  let html = '<h3>Detailed Attendance Tables</h3>';
  
  for (const classData of allClasses) {
    html += await renderClassTable(classData);
  }
  
  detailedTables.innerHTML = html;
  
  // 預設隱藏所有 Week Total 欄位
  const tables = detailedTables.querySelectorAll('.attendance-table');
  tables.forEach(table => {
    table.classList.add('hide-week-total');
  });
}

// 渲染單一班級表格（重用 viewer.js 的邏輯）
async function renderClassTable(classData) {
  const classSessions = allSessions.filter(s => s.class_id === classData.id);
  
  if (classSessions.length === 0) {
    return `
      <div class="class-table-section">
        <h2 class="class-table-title">${classData.name}</h2>
        <div class="empty-state">No records for this month</div>
      </div>
    `;
  }
  
  // 取得該班級的所有學生
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
  
  // 建立日期到 session 的映射（只包含 paid_hours: 1 的 session）
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
  
  // 取得該月份的所有日期（固定從週一開始，顯示完整週曆）
  const selectedMonth = monthSelectRh.value;
  const [year, month] = selectedMonth.split('-');
  const classDays = classData.classDays || [1, 2, 3, 4, 5];
  
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
  
  // 分組為真正的週
  const weeks = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7));
  }
  
  // 建立表格 HTML（唯讀，移除編輯功能）
  let tableHtml = `
    <div class="class-table-section">
      <div class="class-table-header">
        <h2 class="class-table-title">${classData.name}</h2>
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
        
        if (!isInMonth) {
          tableHtml += `<td class="non-month-day"></td>`;
          return;
        }
        
        if (!isClassDay) {
          tableHtml += `<td class="non-class-day">-</td>`;
          return;
        }
        
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
    
    const attendanceRate = scheduledDays > 0 
      ? Math.round((totalHours / scheduledDays) * 100) 
      : 0;
    
    // Engagement Rate = (出席 + 請假) / 預定時數
    const engagementRate = scheduledDays > 0 
      ? Math.round(((totalHours + totalLeave) / scheduledDays) * 100) 
      : 0;
    
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
      
      if (!isInMonth) {
        tableHtml += `<td class="non-month-day"></td>`;
        return;
      }
      
      if (!isClassDay) {
        tableHtml += `<td class="non-class-day"></td>`;
        return;
      }
      
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
  
  const totalScheduledHours = scheduledDays * students.length;
  const classAttendanceRate = totalScheduledHours > 0
    ? Math.round((classTotalHours / totalScheduledHours) * 100)
    : 0;
  
  // 總計 Engagement Rate = (所有學生出席總數 + 所有學生請假總數) / (預定時數 × 學生數量)
  const classEngagementRate = totalScheduledHours > 0
    ? Math.round(((classTotalHours + classTotalLeave) / totalScheduledHours) * 100)
    : 0;
  
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

// 匯出 Excel（重用 viewer.js 的邏輯）
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
  const selectedMonth = monthSelectRh.value;
  const classesToExport = allClasses;
  
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
    const classDays = classData.classDays || [1, 2, 3, 4, 5];
    
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
      const paidHours = session.paid_hours !== undefined ? session.paid_hours : 1;
      const isCancelled = session.cancelled || paidHours === 0;
      
      if (!isCancelled) {
        const date = session.date.toDate();
        const dateKey = date.toISOString().split('T')[0];
        sessionMap[dateKey] = session.attendance || {};
      }
    });
    
    const scheduledDays = Object.keys(sessionMap).length;
    
    // 分組為真正的週
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
          if (!dateInfo.isInMonth) {
            row.push('');
            return;
          }
          
          if (!dateInfo.isClassDay) {
            row.push('-');
            return;
          }
          
          const attendance = sessionMap[dateInfo.dateKey]?.[student.id];
          
          if (attendance === '1') {
            row.push(1);
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
  const fileName = `HR_Performance_Report_${selectedMonth}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}

// 啟動
init();


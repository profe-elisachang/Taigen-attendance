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


    daily-attendance.html  原名為 admin.html
    admin.css
    admin.js
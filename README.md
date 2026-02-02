# Taigen Attendance Management System

一個完整的出勤管理系統，包含老師點名、月曆式記錄、出勤統計與請款功能。

## 功能特色

- 📝 **老師後台點名系統** - 管理班級與學生，記錄每日出缺席
- 📅 **月曆式出缺席記錄** - 以月曆方式查看和編輯出缺席記錄
- 📊 **出勤總覽** - 查看出勤統計，支援 Excel 匯出
- 💰 **請款系統** - 自動生成請款單，支援 PDF 匯出

## 技術架構

- **前端**: HTML, CSS, JavaScript (ES6 Modules)
- **後端**: Firebase (Firestore Database)
- **匯出功能**: Excel, PDF

## 專案結構

```
Taigen-attendance/
├── admin.html          # 老師後台點名系統
├── calendar.html       # 月曆式出缺席記錄
├── viewer.html         # 出勤總覽
├── payment.html        # 請款系統
├── css/                # 樣式檔案
├── js/                 # JavaScript 檔案
│   ├── config.js       # Firebase 配置
│   ├── admin.js        # 後台管理邏輯
│   ├── calendar.js     # 月曆功能
│   ├── viewer.js       # 統計檢視
│   └── payment.js      # 請款功能
└── README.md
```

## 使用說明

1. 開啟 `admin.html` 進行每日點名
2. 使用 `calendar.html` 查看和編輯月曆式記錄
3. 在 `viewer.html` 查看統計並匯出 Excel
4. 使用 `payment.html` 生成請款單並匯出 PDF

## 注意事項

- 請確保 Firebase 配置正確（`js/config.js`）
- 首次使用前請先建立班級和學生資料


# Work Log Manager V3.8.7 — Dashboard, Google Sheet, Excel Export, Edit, File Management, Soft Delete/Restore, Canonical Sheet Order, Fiscal Year
# By :: OMg , 691002

เวอร์ชันนี้ออกแบบสำหรับใช้งานภายในเครื่องด้วย Chrome `Load unpacked`
โดยไม่ใช้ `chrome.identity.getAuthToken()` และไม่ต้องเปิด Chrome Browser Sign-in

## ไฟล์หลัก

- `manifest.json` — MV3 และ OAuth Client ID
- `google-api.js` — Google OAuth + Sheets + Drive
- `background.js` — service worker
- `popup.html`, `popup.js` — บันทึกงาน
- `settings.html`, `settings.js` — ตั้งค่า + เชื่อมต่อ Google
- `dashboard.html`, `dashboard.js` — รายงาน
- `utils.js` — utilities
- `styles.css` — UI

## OAuth สำหรับ Load unpacked

สำหรับ flow นี้ให้สร้าง OAuth Client ประเภท **Web application**
และใช้ `chrome.identity.launchWebAuthFlow()`.

### ขั้นตอน

1. เปิด `chrome://extensions`
2. เปิด Developer mode
3. กด Load unpacked แล้วเลือกโฟลเดอร์นี้
4. จด Extension ID ที่ Chrome แสดง
5. เปิด Settings ของ Work Log Manager
6. คัดลอก `Authorized redirect URI` ที่ระบบแสดง

7. เปิด Google Cloud Console (https://console.cloud.google.com/) สร้าง New Project 
8. เลือก New Project ที่สร้างใหม่ เลือก APIs & Services  →  Enabled APIs & services
9. ค้นหาและเปิด Google Sheets API และ Google Drive API

10. ตั้งค่า OAuth consent screen  : เลือก Credentials  →  Create credentials  →  OAuth client ID  หรือ Google Auth Platform → Clients → Create Client
11. เลือก **Web application**
12. ใส่ Redirect URI ที่คัดลอกมาแบบตรงตัว เช่น:
   `https://<EXTENSION_ID>.chromiumapp.org/oauth2`
13. ที่เมนู Audience ถ้าเป็น External + Testing ให้เพิ่ม Gmail ของคุณเป็น Test user 
14. คัดลอก Client ID ที่สร้างได้ จาก 12.
15. เปิด `manifest.json` แล้วแทน:
   `YOUR_WEB_APPLICATION_CLIENT_ID.apps.googleusercontent.com`
   ด้วย Client ID จริง
16. กลับไป `chrome://extensions` แล้วกด Reload
17. เปิด Settings → คัดลอก Client secret ที่สร้างได้ จาก 12. มาใส่ →  กด **เชื่อมต่อ Google**
18. เลือกบัญชีและกด Allow

### สำคัญ

- ต้องใช้ Redirect URI เดียวกับที่ Extension แสดง
- ห้ามเพิ่ม `/` หรือ path อื่นเอง
- Client ID ใส่ใน `manifest.json`
- ไม่ต้องใส่ Client Secret ลงใน Extension ใส่ใน Settings แทน
- Extension มี `manifest.key` เพื่อให้ ID คงที่ระหว่างการพัฒนา
- หากเปลี่ยน `manifest.key` Extension ID และ Redirect URI จะเปลี่ยน

## การตั้งค่าครั้งแรกของระบบ

- Google OAuth Client ID
- Spreadsheet ID
- Drive Folder ID
- Sheet name
- รูปแบบโฟลเดอร์ Drive

หลังจากนั้นใช้บันทึกงานและอัปโหลดหลายไฟล์ได้ตามระบบเดิม

## การจัดการ Token

Extension ใช้ Authorization Code + PKCE ผ่าน `launchWebAuthFlow()`
เก็บ token ใน `chrome.storage.local` และพยายามต่ออายุ Access Token
โดยใช้ Refresh Token เมื่อมีให้ใช้

หากผู้ใช้เพิกถอนสิทธิ์หรือ Google ทำให้ Refresh Token ใช้ไม่ได้
ระบบจะแจ้งให้เชื่อมต่อ Google ใหม่

## ตรวจสอบก่อนใช้งาน

ตรวจ JavaScript ด้วย:

`node --check <filename>.js`

และต้องเปลี่ยน placeholder ใน `manifest.json` เป็น Client ID จริง
ก่อนกดเชื่อมต่อ Google


## V3.2 OAuth Client Secret

If Google returns `client_secret is missing`, this build supports entering the OAuth Client Secret in Settings > Google Login. The secret is stored in `chrome.storage.local` on the local machine and sent only to Google's token endpoint during authorization-code exchange and refresh.

Important: because this is a Load unpacked browser extension, a value stored in extension storage is not a truly confidential server-side secret. This is a practical local-use workaround, not a secure confidential-client architecture.


## V3.3 — UI / Work Log Window

- คลิกไอคอน Extension แล้วเปิดหน้าบันทึกงานเป็นหน้าต่างแยกขนาดใหญ่
- หน้าต่างจะไม่หายเพียงเพราะคลิกออกนอกฟอร์มเหมือน Chrome popup แบบเดิม
- มีปุ่ม `✕` สำหรับปิดหน้าบันทึกงาน
- เมื่อบันทึกข้อมูลและอัปโหลดไฟล์สำเร็จ ระบบแสดง Toast ที่มุมล่างของหน้าจอว่า `บันทึกข้อมูลงานเรียบร้อยแล้ว`
- หลังบันทึกสำเร็จ 5 วินาที ระบบจะปิดหน้าต่างให้อัตโนมัติ หากผู้ใช้ไม่ได้กลับมาใช้งาน
- ช่วงเวลาจะเลือกค่าเริ่มต้นตามเวลาปัจจุบัน: เช้า / บ่าย / OT โดยยังสามารถเปลี่ยนเองได้
- ปรับขนาดช่องกรอกข้อมูล ปุ่ม และพื้นที่อัปโหลดให้ใหญ่ขึ้น พร้อมปรับ UI ให้ดูเป็นระบบมากขึ้นและเพิ่ม Emoji ในจุดที่เหมาะสม


## V3.4 — UI fixes + Custom Time

- แก้เมนู Dashboard / ตั้งค่าไม่ให้ลอยทับช่องกรอกข้อมูล
- เมนูจะแสดงเป็นแถบปุ่มที่กดง่าย และมีพื้นที่แยกจากฟอร์ม
- ขยายหน้าต่างบันทึกงานเป็นประมาณ 700×940
- ช่วงเวลาเริ่มต้นเลือกตามเวลาปัจจุบัน โดยใช้ช่วงเช้า/บ่าย/OT
- เพิ่ม `กำหนดเอง` พร้อมช่อง `เวลาเริ่ม` และ `เวลาสิ้นสุด`
- เมื่อเลือกกำหนดเอง ระบบตั้งต้นเป็นชั่วโมงปัจจุบัน :00 และชั่วโมงถัดไป :00
- ตรวจสอบไม่ให้เวลาสิ้นสุดน้อยกว่าหรือเท่ากับเวลาเริ่ม
- Toast แจ้งผลยังอยู่มุมล่างและอ่านง่ายขึ้น


## V3.5 — Right-center Work Log Window

- หน้าบันทึกงานเปิดเป็นหน้าต่าง Popup ทางด้านขวาของจอ และจัดให้อยู่กึ่งกลางแนวตั้ง
- ใช้พื้นที่ทำงาน (Work Area) ของจอหลัก จึงหลบ Taskbar/พื้นที่ระบบ
- หากเปิดหน้าต่างเดิมอยู่ ระบบจะย้ายกลับมาตำแหน่งด้านขวาและโฟกัสให้อัตโนมัติ
- เพิ่ม permission `system.display` เพื่อคำนวณตำแหน่งหน้าต่างอย่างเหมาะสม


## V3.7 — Fiscal Quarter Fix

ไตรมาสที่บันทึกใน Google Sheets ใช้ปีงบประมาณ:
- เดือน 10–12 = Q1
- เดือน 1–3 = Q2
- เดือน 4–6 = Q3
- เดือน 7–9 = Q4

ดังนั้นวันที่ 02/10/2026 จะถูกบันทึกเป็น `Q1` ไม่ใช่ `Q4`.


## V3.7 — Fiscal Quarter Migration + 24-hour Custom Time

- ตรวจและแก้ค่าไตรมาสเดิมในคอลัมน์ N ตามปีงบประมาณโดยอัตโนมัติเมื่อทดสอบ/บันทึกการตั้งค่า Google Sheet
- 10–12 = Q1, 1–3 = Q2, 4–6 = Q3, 7–9 = Q4
- เวลากำหนดเองใช้รูปแบบ 24 ชั่วโมง HH:mm เช่น 08:00, 13:00, 18:30
- ตรวจสอบเวลา 00:00–23:59 และกำหนดให้เวลาสิ้นสุดมากกว่าเวลาเริ่ม


## V3.8 — Dashboard Management

V3.8 keeps the existing Google OAuth, Google Sheets, Google Drive and multi-file upload workflow from V3.7 and adds:

### Dashboard
- Period tabs: วันนี้ / เดือน / 3 เดือน / 6 เดือน / 1 ปี
- Bar chart for work counts
- Line chart for work trends
- Status pie chart using real Google Sheets data
- Summary cards for total / completed / in progress / pending / evidence files
- Status filter and keyword search
- Fiscal-year display: October–December = Q1, January–March = Q2, April–June = Q3, July–September = Q4
- Fiscal year example: October 2026 = FY 2570, Q1

### Excel
- `📗 เปิด Excel` exports the currently selected period and filters to `.xlsx`, then asks the OS to open it with the associated Excel application.
- `⬇️ Export Excel` downloads the same data without opening it.
- XLSX generation is built into the extension; no external CDN/library is required.

### Edit
Dashboard can edit:
- วันที่
- ช่วงเวลา
- ประเภทงาน
- ชื่องาน
- รายละเอียด
- สถานะ
- Link งาน
- เพิ่มไฟล์แนบ
- ย้ายไฟล์แนบที่ไม่ต้องการไป `_ARCHIVE_ATTACHMENTS`

### Soft Delete / Restore
- Dashboard does not physically delete the Sheet row.
- A deleted task gets `RecordStatus = DELETED`.
- The task folder is moved to `_ARCHIVE` under the configured root Drive folder.
- The original parent folder is stored in `OriginalParentID`.
- `🗄️ งานที่ลบ` displays deleted records.
- `↩️ กู้คืน` moves the task folder back and changes `RecordStatus` to `ACTIVE`.

### V3.8 Sheet columns

Original V3.7 columns A:O remain unchanged. V3.8 appends:

- P `RecordStatus`
- Q `DeletedAt`
- R `OriginalParentID`
- S `FiscalYear`
- T `WorkURL`

Existing V3.7 data is not rewritten just to add these columns. The header is migrated automatically when the Dashboard/Settings checks the Sheet.

### Important
The configured OAuth scope remains Google Sheets + Google Drive. Because V3.8 adds Drive file/folder management, the extension must retain Drive permission/scope.

### Validation
Before loading the unpacked extension, check:

- `node --check dashboard.js`
- `node --check google-api.js`
- `node --check popup.js`
- `node --check utils.js`

Then reload the extension from `chrome://extensions`.


## V3.8.3 Fixes

- Edit custom time now starts with the current hour and the following hour (e.g. 20:00–21:00), while preserving an existing saved custom range.
- Attachment names in the Edit dialog are displayed at a maximum of 50 characters with the full filename available through the browser tooltip.
- Dashboard summary cards now include all five statuses: เสร็จแล้ว, กำลังดำเนินการ, รอดำเนินการ, มีปัญหา, and อื่น ๆ, plus the total attachment count.


## V3.8.7
- Dashboard เพิ่มช่วง 9 เดือน
- Dashboard เพิ่มช่วงกำหนดเอง เลือกวันเริ่ม/วันสิ้นสุด และตรวจสอบไม่ให้วันสิ้นสุดน้อยกว่าวันเริ่ม
- เพิ่มปฏิทินไทยสำหรับวันที่ในหน้าบันทึกงานและหน้ากำหนดเอง/แก้ไขงาน: แสดงเดือนภาษาไทยและปี พ.ศ.
- วันที่ที่บันทึกลง Google Sheet ใช้รูปแบบปี พ.ศ. และระบบจะปรับวันที่เก่าให้เป็น พ.ศ. เมื่อเตรียม Sheet

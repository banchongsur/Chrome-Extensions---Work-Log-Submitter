// รอให้ DOM โหลดเสร็จก่อนจับ Event
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('workLogForm');

    form.addEventListener('submit', async function(event) {
        event.preventDefault();

        // 1. Sanitize ข้อมูล (ตัดช่องว่างหัวท้าย) ตามมาตรฐาน Strict File Handling
        const taskName = document.getElementById("taskName").value.trim();
        const timePeriod = document.getElementById("timePeriod").value.trim();
        const details = document.getElementById("details").value.trim();
        const timestamp = new Date().toLocaleString("th-TH");

        // 2. ปรับ UI เป็นสถานะกำลังโหลด
        showLoading(true);

        try {
            // 3. ขอ OAuth Token จาก Chrome
            const token = await getOAuthToken();
            
            // 4. ส่ง Request พร้อมกัน 2 ปลายทาง (Dual-write)
            const results = await Promise.allSettled([
                submitToOfficialForm(taskName, timePeriod, details),
                backupToPersonalSheet(token, timestamp, taskName, timePeriod, details)
            ]);

            // เช็คผลลัพธ์แยกกันเผื่อกรณีใดกรณีหนึ่งพัง จะได้ debug ได้ง่าย
            const formResult = results[0];
            const sheetResult = results[1];

            if (formResult.status === 'rejected') {
                console.error("ส่ง Form องค์กรล้มเหลว:", formResult.reason);
                throw new Error("ส่งฟอร์มองค์กรไม่สำเร็จ");
            }
            if (sheetResult.status === 'rejected') {
                console.warn("สำรองข้อมูลลง Sheet ล้มเหลว:", sheetResult.reason);
                // อาจจะไม่โยน Error ถ้าอยากให้ Form หลักยังทำงานต่อได้
            }

            // แสดงผลว่าสำเร็จและล้างฟอร์ม
            showToast("บันทึกข้อมูลและสำรองลง Sheet สำเร็จ!", "success");
            form.reset();

        } catch (error) {
            console.error("เกิดข้อผิดพลาดหลัก:", error);
            showToast("พบปัญหา: " + error.message, "error");
        } finally {
            // 5. คืนสภาพปุ่มกลับมาเหมือนเดิมเสมอ
            showLoading(false);
        }
    });
});

// ==========================================
// ส่วนฟังก์ชัน API และ Authentication
// ==========================================

// ฟังก์ชันขอ OAuth Token จาก Chrome Identity
function getOAuthToken() {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, function(token) {
            if (chrome.runtime.lastError || !token) {
                reject(new Error(chrome.runtime.lastError.message || "ไม่สามารถขอ Token ได้ (ตรวจสอบ Client ID และ Key)"));
            } else {
                resolve(token);
            }
        });
    });
}

// ฟังก์ชันส่งไป Google Sheet ส่วนตัว (ผ่าน API อย่างเป็นทางการ)
async function backupToPersonalSheet(token, timestamp, taskName, timePeriod, details) {
    // 🔴 เปลี่ยน YOUR_PERSONAL_SHEET_ID เป็น ID ของ Sheet ส่วนตัวอาจารย์
    const spreadsheetId = "YOUR_PERSONAL_SHEET_ID";
    // 🔴 เปลี่ยน Sheet1 ถ้าแท็บของอาจารย์ชื่ออื่น (เช่น ข้อมูลการทำงาน!A:D)
    const range = "Sheet1!A:D"; 
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

    const requestBody = {
        values: [
            [timestamp, taskName, timePeriod, details]
        ]
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        throw new Error(`Google Sheets API Error: ${response.status}`);
    }
    return await response.json();
}

// ฟังก์ชันส่งไป Google Form ของหน่วยงาน (No-CORS)
async function submitToOfficialForm(taskName, timePeriod, details) {
    // 🔴 เปลี่ยน YOUR_OFFICIAL_FORM_ID เป็น ID ของ Form องค์กร
    const formUrl = "https://docs.google.com/forms/d/e/YOUR_OFFICIAL_FORM_ID/formResponse";
    const formData = new FormData();
    
    // 🔴 เปลี่ยน entry.xxxxxx ให้ตรงกับฟิลด์ใน Google Form
    formData.append("entry.11111111", taskName);
    formData.append("entry.22222222", timePeriod);
    formData.append("entry.33333333", details);

    return fetch(formUrl, {
        method: "POST",
        mode: "no-cors", // จำเป็นต้องใช้เพื่อเลี่ยง CORS ของ Form
        body: formData
    });
}

// ==========================================
// ส่วนฟังก์ชันจัดการ UI (Modern Clean)
// ==========================================

function showLoading(isLoading) {
    const btnText = document.getElementById("btnText");
    const spinner = document.getElementById("loadingSpinner");
    const btn = document.getElementById("submitBtn");
    
    if (isLoading) {
        btnText.textContent = "กำลังบันทึก...";
        spinner.style.display = "inline-block"; // เปลี่ยนจาก block เป็น inline-block ให้อยู่ระนาบเดียวกับข้อความ
        btn.disabled = true;
    } else {
        btnText.textContent = "บันทึกข้อมูล";
        spinner.style.display = "none";
        btn.disabled = false;
    }
}

function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    
    // รีเซ็ตคลาสเก่าก่อน
    toast.className = `toast ${type}`;
    toast.style.display = "block";
    
    // ให้ข้อความหายไปเองใน 4 วินาที
    setTimeout(() => {
        toast.style.display = "none";
        toast.className = "toast";
    }, 4000);
}
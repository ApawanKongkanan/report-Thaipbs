const sql = require("mssql");
require("dotenv").config(); // ดึงตัวแปรจากไฟล์ .env (ถ้ามี)

// ==========================================
// ☁️ ตัวเลือกที่ 1: ฐานข้อมูล Azure SQL (ระบบคลาวด์)
// ==========================================
const azureConfig = {
  server: "missingperson.database.windows.net", 
  database: "MissingpersonDB",
  user: "thaipbs",
  password: "Strongpassword123", 
  port: 1433,
  options: {
    encrypt: true, // สำคัญ: Azure บังคับให้เป็น true เสมอ
    trustServerCertificate: false, 
    enableArithAbort: true
  },
};

// ==========================================
// 💻 ตัวเลือกที่ 2: ฐานข้อมูล Local SQL (ทดสอบในเครื่องตัวเอง)
// ==========================================
const localConfig = {
  // หากใช้ SQLExpress ให้เปลี่ยนเป็น "localhost\\SQLEXPRESS"
  server: "localhost", 
  database: "Missingperson",
  // หากใช้ Windows Authentication ให้คอมเมนต์ user/password ทิ้ง แล้วเปิดใช้ integrated security
  user: "sa", // กรอก Username ของ SQL Server ในเครื่องคุณ
  password: "itismystrongpa@@word", // กรอกรหัสผ่านของ SQL Server ในเครื่องคุณ
  port: 1433,
  options: {
    encrypt: false, // รันในเครื่องตัวเองปิด encrypt ได้
    trustServerCertificate: true,
    enableArithAbort: true
  },
};

// ==========================================
// 🌟 จุดสลับการเชื่อมต่อ (Switch Connection) 🌟
// ==========================================
// วิธีใช้: ต้องการใช้ตัวไหน ให้เอาเครื่องหมาย // ข้างหน้าออก แล้วใส่ // ปิดตัวที่ไม่ได้ใช้

// const dbConfig = azureConfig; // <-- เปิดบรรทัดนี้เมื่อต้องการใช้ Azure
const dbConfig = localConfig; // <-- เปิดบรรทัดนี้เมื่อต้องการทดสอบในเครื่อง (ปัจจุบันเลือกตัวนี้อยู่)

module.exports = { sql, dbConfig };
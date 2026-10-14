const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        success: false,
        message: "กรุณาเข้าสู่ระบบก่อนใช้งาน",
      });
    }

    if (req.session.user.role !== role) {
      return res.status(403).json({
        success: false,
        message: "คุณไม่มีสิทธิ์ดำเนินการนี้",
      });
    }

    next();
  };
}

const { sql, dbConfig } = require("../config/db"); 
const multer = require('multer');// ไลบรารีจัดการการอัปโหลดไฟล์ (multipart/form-data)
const { BlobServiceClient } = require('@azure/storage-blob');// สำหรับเชื่อมต่อและจัดการไฟล์บน Azure
const path = require('path');// ใช้สำหรับจัดการ path ของไฟล์
const sharp = require('sharp');// ไลบรารีสำหรับจัดการรูปภาพ (ย่อขนาด, บีบอัด)
const fs = require('fs');// ใช้จัดการไฟล์และโฟลเดอร์ในระบบ
const axios = require('axios'); // ใช้สำหรับยิง HTTP Request ไปหา API ภายนอก (Typhoon AI)
const FormData = require('form-data');// ใช้สร้างฟอร์มข้อมูลเพื่อส่งไปพร้อมกับ API

// 🔍 [ระบบตรวจสอบการโหลด .env] 
// ทดลองโหลดจาก 2 ตำแหน่งที่มักจะวางไฟล์กันพลาด
const envPathBackend = path.join(__dirname, '../.env'); // โฟลเดอร์ Backend
const envPathRoot = path.join(__dirname, '../../.env');   // โฟลเดอร์นอกสุด (Root Workspace)

if (fs.existsSync(envPathBackend)) {
    require('dotenv').config({ path: envPathBackend });
    console.log("✅ Loaded .env from Backend folder:", envPathBackend);
} else if (fs.existsSync(envPathRoot)) {
    require('dotenv').config({ path: envPathRoot });
    console.log("✅ Loaded .env from Root folder:", envPathRoot);
} else {
    require('dotenv').config(); 
    console.warn("⚠️ ไม่พบไฟล์ .env ในตำแหน่งมาตรฐาน ระบบจะใช้ค่าจาก Environment ของระบบหลัก");
}

// 🛠️ ตรวจสอบและสร้างโฟลเดอร์ uploads อัตโนมัติ ป้องกัน Error: ENOENT บน Azure
const uploadDir = path.join(process.cwd(), 'uploads'); 
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 1. ตั้งค่า Multer ให้ใช้ memoryStorage เพื่อไม่ให้เขียนลง Disk
const upload = multer({ storage: multer.memoryStorage() });

// 2. ฟังก์ชันอัปโหลดขึ้น Azure Blob (มีระบบตรวจสอบตัวแปรป้องกันการแครช)
async function uploadFileToBlob(file) {
    if (!file) return null;
    
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
    if (!connectionString || !containerName) {
        throw new Error(`❌ ตัวแปรสำหรับ Azure Storage ไม่ครบถ้วนใน .env`);
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    
    // ดึงเฉพาะนามสกุลไฟล์ (.jpg / .png / .webp)
    const fileExtension = path.extname(file.originalname) || '.jpg';
    // ใช้ Timestamp ผสมตัวเลขสุ่ม เป็นชื่อไฟล์ กันชื่อไฟล์ภาษาไทย/อักขระแปลก
    const blobName = `${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}${fileExtension}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(file.buffer);
    return blockBlobClient.url; 
}

// ==========================================
// 🚀 API 1: อ่านใบแจ้งความ (OCR)
// ==========================================
// รับไฟล์ภาพใบแจ้งความผ่านฟิลด์ที่ชื่อว่า 'police_doc_ocr'
router.post('/ocr', upload.single('police_doc_ocr'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'ไม่พบไฟล์รูปภาพ' });
        }

        // --- เตรียมรูปภาพก่อนส่งให้ AI ---
        const imageBuffer = await sharp(req.file.buffer)
            .resize({ width: 1200, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

        // --- สร้างชุดข้อมูล (FormData) สำหรับยิง API ---
        const form = new FormData();
        form.append('file', imageBuffer, { filename: 'upload.jpg' });
        form.append('model', 'typhoon-ocr');
        form.append('task_type', 'default');
        
        // บังคับให้ AI สกัดวัตถุประสงค์/รายละเอียดการแจ้งความเพิ่มเข้ามาด้วย
        const ocrPrompt = `
อ่านเอกสารใบแจ้งความนี้แล้วสกัดข้อมูลออกมาเป็น JSON เท่านั้น โดยมีโครงสร้างดังนี้:
{
    "policereport_number": "เลขที่ใบแจ้งความ",
    "policereport_date": "วันที่",
    "policereport_time": "เวลา",
    "policereport_location": "สน.",
    "policereport_name": "ชื่อตำรวจ",
    "policereport_purpose": "สรุปเนื้อหาวัตถุประสงค์ย่อๆ ว่ามาแจ้งความเรื่องอะไร เช่น ร้องทุกข์กล่าวโทษบุคคล หรือ แจ้งความคนหาย"
}
ห้ามมีข้อความอื่นหรือ Markdown ปะปนมาเด็ดขาด
`;
        form.append('prompt', ocrPrompt);

        // ยิง API ไปที่ Typhoon
        const typhoonResponse = await axios.post(
            'https://api.opentyphoon.ai/v1/ocr',
            form,
            { headers: { ...form.getHeaders(), 'Authorization': `Bearer ${process.env.TYPHOON_API_KEY}` } }
        );

        const rawContent = typhoonResponse.data.results[0].message.choices[0].message.content;
        console.log("👉 ข้อความดิบที่ AI อ่านได้:\n", rawContent);

        let extractedData;
        try {
            // ลองให้ระบบแปลงเป็น JSON ดูก่อน
            const cleanText = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
            extractedData = JSON.parse(cleanText);
        } catch (parseError) {
            // 🚨 ระบบสำรอง: สกัดคำด้วย Regex
            const locationMatch = rawContent.match(/(?:สน\.|ส\.น\.|สภ\.|ส\.ภ\.|สถานีตำรวจนครบาล|สถานีตำรวจภูธร|สถานีตำรวจ)\s*([ก-๙\.]+)/);
            const dateMatch = rawContent.match(/(\d{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*\d{2,4})/);
            const timeMatch = rawContent.match(/(\d{1,2}[:\.]\d{2})\s*(?:น\.|น|นาฬิกา)/);
            const numberMatch = rawContent.match(/(?:ปจว\.?ข้อ|ลำดับ(?:ที่)?|เลขที่|เลขรับ).*?(\d+)/s);
            
            // ดักจับยศตำรวจและชื่อ
            const officerMatch = rawContent.match(/(?:พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.)\s*([ก-๙]+\s+[ก-๙]+)/);
            
            // ดักจับข้อความที่เป็นเนื้อหา แล้วเก็บไว้ทั้งหมดโดยไม่ตัดทิ้ง
            const purposeMatch = rawContent.match(/(?:แจ้งว่า|ร้องทุกข์ว่า|รายละเอียด|บันทึกรับคำร้องทุกข์)\s*(.*)/s);
            let fallbackPurpose = "แจ้งความคนหาย/ร้องทุกข์คดี";
            
            if (purposeMatch) {
                fallbackPurpose = purposeMatch[1].replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
            }

            extractedData = {
                policereport_number: numberMatch ? numberMatch[1].trim() : "",
                policereport_date: dateMatch ? dateMatch[1].trim() : "",
                policereport_time: timeMatch ? timeMatch[1].replace('.', ':').trim() : "",
                policereport_location: locationMatch ? "สน./สภ. " + locationMatch[1].replace('สภ.', '').trim() : "",
                policereport_name: officerMatch ? officerMatch[0].trim() : "",
                policereport_purpose: fallbackPurpose
            };
        }

        // แนบฟิลด์เอกสาร
        extractedData.policereport_document = ""; 

        res.json({ 
            success: true, 
            data: extractedData,
            message: "อ่านเอกสารสำเร็จ"
        });

    } catch (err) {
        console.error('OCR Error:', err.message);
        res.status(500).json({ 
            success: false, 
            message: 'เกิดข้อผิดพลาดในการอ่านเอกสาร',
            details: err.message 
        });
    }
});

// ==========================================
// 🚀 API: บันทึกข้อมูลแจ้งคนหายลง Database
// ==========================================

// --- สถานะเคสทั้งหมด (7 สถานะ) ---
const CASE_STATUSES = {
  RECEIVED: 'รับแจ้งเหตุ',
  REVIEWING: 'กำลังตรวจสอบข้อมูล',
  SEARCHING: 'กำลังค้นหา - ประกาศโพสต์หา',
  FOUND_SAFE: 'พบเจอ - ปลอดภัย',
  FOUND_DEAD: 'พบเจอ - เสียชีวิต',
  RESUMED: 'กลับมาค้นหาอีกครั้ง',
  CLOSED: 'ปิดเคส',
};

// --- แปลงเวลาให้อยู่ในรูปแบบ HH:mm:ss (คอลัมน์ TIME) ---
function normalizeTime(t) {
  if (!t) return '00:00';
  const match = String(t).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return '00:00';
  const h = String(parseInt(match[1], 10)).padStart(2, '0');
  const m = match[2];
  const s = match[3] || '00';
  return `${h}:${m}:${s}`;
}

// --- แปลงค่าเป็น Date หรือ null ---
function safeDate(d) {
  if (!d || (typeof d === 'string' && d.trim() === '')) return null;
  const date = new Date(d);
  return isNaN(date.getTime()) ? null : date;
}

// --- แปลงค่าเป็น int หรือ null ---
function safeInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// ==========================================
// 🚀 API: บันทึกเคสแจ้งคนหาย 
// ==========================================
router.post(
  '/cases',
  requireRole('admin'),
  upload.fields([
    { name: 'missing_image', maxCount: 1 },
    { name: 'police_document', maxCount: 1 },
  ]),
  async (req, res) => {
    let transaction;
    try {
      const body = req.body || {};
      const pool = await sql.connect(dbConfig);
      transaction = new sql.Transaction(pool);
      await transaction.begin();


      // 🌟 แก้ไข: ฟอร์มส่ง causes มาเป็น JSON string ต้อง parse ก่อน (ไม่งั้น case_missing_reason จะว่างเปล่าเสมอ)
      let causes = [];
      try { causes = JSON.parse(body.causes || '[]'); } catch (e) {}
      const cleanCausesText = causes.map((c) => `${c.rank}. ${c.name}`).join(', ');

      const missingImageFile = req.files && req.files.missing_image ? req.files.missing_image[0] : null;
      const policeDocFile = req.files && req.files.police_document ? req.files.police_document[0] : null;
      const missingImageUrl = await uploadFileToBlob(missingImageFile);
      const policeDocUrl = await uploadFileToBlob(policeDocFile);

      const missingAge = safeInt(body.missing_age);
      const missingHeight = safeInt(body.missing_height);
      const missingBirthdate = safeDate(body.missing_birthdate);
      const lastSeenDate = safeDate(body.last_seen_date);
      const reportDate = safeDate(body.policereport_date) || new Date();

      
      const reporterIdType = body.reporter_id_type || "ไม่ระบุ";
      const reporterIdNumber = body.reporter_id_number || "-";

      // จัดรูปแบบเลขบัตรประชาชนเป็น X-XXXX-XXXXX-XX-X
      const digitsOnly = String(reporterIdNumber).replace(/\D/g, "");

      const formattedReporterId =
      reporterIdType === "บัตรประชาชน" && /^\d{13}$/.test(digitsOnly)
      ? `${digitsOnly[0]}-${digitsOnly.slice(1, 5)}-${digitsOnly.slice(5, 10)}-${digitsOnly.slice(10, 12)}-${digitsOnly[12]}`
      : reporterIdNumber;

      const finalReporterIdentity =
      `${reporterIdType}: ${formattedReporterId}`;

      const finalMissingIdentity = `${body.missing_id_type || 'ไม่ระบุ'}: ${body.missing_id_number || '-'}`;

      // --- 1. People --- 
      
      // --- 1. People ---
      const normalizePhoneForMatch = (value) => {
        let phone = String(value ?? "").replace(/\D/g, "");

        if (phone.startsWith("66") && phone.length === 11) {
          phone = "0" + phone.slice(2);
        }

        return phone;
      };

      const normalizeIdentityForMatch = (value) => {
        const text = String(value ?? "").trim();
        const separator = text.indexOf(":");

        if (separator < 0) return text.toLowerCase();

        const type = text.slice(0, separator).trim().toLowerCase();
        const number = text.slice(separator + 1).trim();

        if (type === "บัตรประชาชน") {
          return `${type}:${number.replace(/\D/g, "")}`;
        }

        return `${type}:${number.replace(/\s+/g, " ").toLowerCase()}`;
      };

      const reporterPhoneNormalized =
        normalizePhoneForMatch(body.reporter_phone);

      const reporterPhoneInternational =
        reporterPhoneNormalized.startsWith("0")
          ? `66${reporterPhoneNormalized.slice(1)}`
          : reporterPhoneNormalized;

      // ค้นหาบุคคลที่มีเบอร์โทรศัพท์ตรงกันก่อน
      const existingPeopleResult = await transaction.request()
        .input("phone", sql.NVarChar(30), reporterPhoneNormalized)
        .input("phoneInternational", sql.NVarChar(30), reporterPhoneInternational)
        .query(`
          SELECT people_id, people_phone, people_identity
          FROM dbo.People WITH (UPDLOCK, HOLDLOCK)
          WHERE REPLACE(
                  REPLACE(
                    REPLACE(LTRIM(RTRIM(people_phone)), '-', ''),
                    ' ', ''
                  ),
                  '+', ''
                ) IN (@phone, @phoneInternational)
        `);

      // ต้องตรงทั้งเบอร์โทรศัพท์และเอกสารยืนยันตัวตน
      const identityKey = normalizeIdentityForMatch(finalReporterIdentity);

      const matchingPeople = existingPeopleResult.recordset.filter((person) => {
        return (
          normalizePhoneForMatch(person.people_phone) === reporterPhoneNormalized &&
          normalizeIdentityForMatch(person.people_identity) === identityKey
        );
      });

      if (matchingPeople.length > 1) {
        if (transaction.isActive) await transaction.rollback();

        return res.status(409).json({
          success: false,
          message: "พบข้อมูลผู้แจ้งซ้ำในระบบ กรุณาติดต่อเจ้าหน้าที่",
        });
      }

      let people_id;

      if (matchingPeople.length === 1) {
        // มีบุคคลนี้อยู่แล้ว ใช้ people_id เดิม
        people_id = matchingPeople[0].people_id;
      } else {
        // ยังไม่มีข้อมูลบุคคล จึงสร้างแถวใหม่ที่ยังไม่มีบัญชี
        const personInsertResult = await transaction.request()
          .input("people_title", sql.NVarChar, body.reporter_title || "")
          .input("people_name", sql.NVarChar, body.reporter_name || "")
          .input("people_phone", sql.NVarChar, body.reporter_phone || "")
          .input("people_identity", sql.NVarChar, finalReporterIdentity)
          .input("people_account", sql.NVarChar, null)
          .input("people_password_hash", sql.NVarChar, null)
          .query(`
            SET NOCOUNT ON;

            INSERT INTO dbo.People (
              people_title,
              people_name,
              people_phone,
              people_identity,
              people_account,
              people_password_hash
            )
            VALUES (
              @people_title,
              @people_name,
              @people_phone,
              @people_identity,
              @people_account,
              @people_password_hash
            );

            SELECT CAST(SCOPE_IDENTITY() AS INT) AS new_id;
          `);

        people_id = personInsertResult.recordset[0].new_id;
      }


      const forceCreate = body.force_create === true || body.force_create === 'true';
      if (!forceCreate && body.missing_name && body.missing_name.trim() !== '') {
        const dup = await transaction.request()
          .input('dup_name', sql.NVarChar, body.missing_name)
          .query(`
            SET NOCOUNT ON;
            SELECT TOP 1 c.case_id
            FROM MissingPerson m
            JOIN MissingCase c ON c.missingperson_id = m.missingperson_id
            WHERE m.missingperson_name = @dup_name
              AND c.case_latest_status NOT IN (N'พบเจอ - ปลอดภัย', N'พบเจอ - เสียชีวิต', N'ปิดเคส');
          `);
        if (dup.recordset.length > 0) {
          const existing_case_id = dup.recordset[0].case_id;
          if (transaction.isActive) await transaction.rollback();
          return res.status(409).json({
            success: false,
            warning: 'duplicate_open_case',
            message: `พบเคสคนหายที่กำลังดำเนินการอยู่แล้ว (รหัสเคส ${existing_case_id}) หากต้องการบันทึกซ้ำโปรดยืนยันการสร้างเคส`,
            existing_case_id,
          });
        }
      }

      // --- 2. MissingPerson ---
      result = await transaction.request()
        .input('missingperson_title', sql.NVarChar, body.missing_title || '')
        .input('missingperson_name', sql.NVarChar, body.missing_name || '')
        .input('missingperson_identity', sql.NVarChar, finalMissingIdentity)
        .input('missingperson_gender', sql.NVarChar, body.missing_gender || 'ไม่ระบุ')
        .input('missingperson_birthday', sql.Date, missingBirthdate)
        .input('missingperson_age', sql.Int, missingAge)
        .input('missingperson_race', sql.NVarChar, body.missing_nationality || 'ไทย')
        .query(`
          SET NOCOUNT ON;
          INSERT INTO MissingPerson (missingperson_title, missingperson_name, missingperson_identity, missingperson_gender, missingperson_birthday, missingperson_age, missingperson_race)
          VALUES (@missingperson_title, @missingperson_name, @missingperson_identity, @missingperson_gender, @missingperson_birthday, @missingperson_age, @missingperson_race);
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS new_id;
        `);
      const missingperson_id = result.recordset[0].new_id;

      // --- 3. PoliceStation (ค้นหาหรือสร้างใหม่) ---
      result = await transaction.request()
        .input('policestation_name', sql.NVarChar, body.police_station || 'ไม่ระบุ สน/สภ')
        .input('policestation_province', sql.NVarChar, body.police_province || 'ไม่ระบุ')
        .query(`
          SET NOCOUNT ON;
          DECLARE @actual INT;
          SELECT @actual = policestation_id FROM PoliceStation WHERE policestation_name = @policestation_name;
          IF @actual IS NULL
          BEGIN
            INSERT INTO PoliceStation (policestation_name, policestation_province, policestation_phone)
            VALUES (@policestation_name, @policestation_province, '191');
            SET @actual = CAST(SCOPE_IDENTITY() AS INT);
          END
          SELECT @actual AS final_station_id;
        `);
      const final_police_station_id = result.recordset[0].final_station_id;

      // --- 4. MissingCase --- (บันทึกเพิ่มเติมจากฟอร์ม)
      const case_relation = body.reporter_relationship === 'อื่นๆ'
        ? (body.reporter_relationship_other || '')
        : (body.reporter_relationship || '');
      // เจ้าหน้าที่ผู้รับเคส ส่งมาจาก session/หน้าเว็บ ถ้าไม่มีเป็น null ได้
const staff_id = req.session.user.user_id;
      result = await transaction.request()
        .input('case_priority', sql.NVarChar, body.urgency_level || 'ปกติ')
        .input('case_latest_status', sql.NVarChar, CASE_STATUSES.RECEIVED)
        .input('case_missing_reason', sql.NVarChar, cleanCausesText)
        .input('case_received_date', sql.DateTime, new Date())
        .input('case_notes', sql.NVarChar, body.case_notes || '')
        .input('case_relation_to_missing', sql.NVarChar, case_relation)
        .input('staff_id', sql.Int, staff_id)
        .input('people_id', sql.Int, people_id)
        .input('missingperson_id', sql.Int, missingperson_id)
        .input('police_station_id', sql.Int, final_police_station_id)
        .query(`
          SET NOCOUNT ON;
          INSERT INTO MissingCase (case_priority, case_latest_status, case_missing_reason, case_received_date, case_notes, case_relation_to_missing, staff_id, people_id, missingperson_id, police_station_id)
          VALUES (@case_priority, @case_latest_status, @case_missing_reason, @case_received_date, @case_notes, @case_relation_to_missing, @staff_id, @people_id, @missingperson_id, @police_station_id);
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS new_id;
        `);
      const case_id = result.recordset[0].new_id;

      // --- 5. StatusLog --- (log_id เดียวใช้ร่วมกับสองตารางลูก)
      result = await transaction.request()
        .input('case_id', sql.Int, case_id)
        .input('log_case_status', sql.NVarChar, CASE_STATUSES.RECEIVED)
        .input('log_logged_by', sql.NVarChar, body.reporter_name || 'System')
        .input('log_description', sql.NVarChar, 'ผู้แจ้งสร้างเคสคนหายเข้าระบบตรวจสอบผ่านพอร์ทัลหลัก')
        .query(`
          SET NOCOUNT ON;
          INSERT INTO StatusLog (case_id, log_case_status, log_logged_by, log_description)
          VALUES (@case_id, @log_case_status, @log_logged_by, @log_description);
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS new_id;
        `);
      const log_id = result.recordset[0].new_id;

      // --- 6. Last_Seen_Log ---
      await transaction.request()
        .input('log_id', sql.Int, log_id)
        .input('last_seen_date', sql.Date, lastSeenDate)
        .input('last_seen_time', sql.VarChar, normalizeTime(body.time_start))
        .input('last_seen_place', sql.NVarChar, body.last_seen_place || '')
        .input('last_seen_subdistrict', sql.NVarChar, body.subdistrict || '')
        .input('last_seen_district', sql.NVarChar, body.district || '')
        .input('last_seen_province', sql.NVarChar, body.province || '')
        .query(`
          INSERT INTO Last_Seen_Log (log_id, Last_Seen_date, Last_Seen_time, Last_Seen_place, Last_Seen_subdistrict, Last_Seen_district, Last_Seen_province)
          VALUES (@log_id, @last_seen_date, @last_seen_time, @last_seen_place, @last_seen_subdistrict, @last_seen_district, @last_seen_province);
        `);

      // --- 7. Missingperson_Character_Log --- (สีผมจากฟอร์ม)
      const skinColor = body.skin_color === 'อื่นๆ' ? (body.skin_color_other || '') : (body.skin_color || 'ไม่ระบุ');
      const bodyShape = body.body_shape === 'อื่นๆ' ? (body.body_shape_other || '') : (body.body_shape || 'ไม่ระบุ');
      const hairStyle = body.hair_style === 'อื่นๆ' ? (body.hair_style_other || '') : (body.hair_style || 'ไม่ระบุ');

      await transaction.request()
        .input('log_id', sql.Int, log_id)
        .input('character_image_url', sql.NVarChar(2083), missingImageUrl || '')
        .input('character_skin_color', sql.NVarChar, skinColor)
        .input('character_body_shape', sql.NVarChar, bodyShape)
        .input('character_hair_style', sql.NVarChar, hairStyle)
        .input('character_hair_color', sql.NVarChar, body.hair_color || 'ไม่ระบุ')
        .input('character_height_cm', sql.Int, missingHeight)
        .query(`
          INSERT INTO Missingperson_Character_Log (log_id, character_image_url, character_skin_color, character_body_shape, character_hair_style, character_hair_color, character_height_cm)
          VALUES (@log_id, @character_image_url, @character_skin_color, @character_body_shape, @character_hair_style, @character_hair_color, @character_height_cm);
        `);

      // --- 8. PoliceReport ---
      const policereport_number = body.policereport_number || `PR-${Date.now().toString().slice(-6)}`;
      const policereport_location = body.policereport_location || body.police_station || 'ไม่ระบุ';

      await transaction.request()
        .input('policereport_number', sql.NVarChar, policereport_number)
        .input('policereport_date', sql.DateTime, reportDate)
        .input('policereport_time', sql.VarChar, normalizeTime(body.policereport_time))
        .input('policereport_location', sql.NVarChar, policereport_location)
        .input('policereport_purpose', sql.NVarChar, body.policereport_purpose || 'แจ้งความคนหาย')
        .input('policereport_document', sql.NVarChar(2083), policeDocUrl || '')
        .input('policereport_name', sql.NVarChar, body.policereport_name || 'ไม่ระบุชื่อ')
        .input('case_id', sql.Int, case_id)
        .input('policestation_id', sql.Int, final_police_station_id)
        .query(`
          INSERT INTO PoliceReport (policereport_number, policereport_date, policereport_time, policereport_location, policereport_purpose, policereport_document, policereport_name, case_id, policestation_id)
          VALUES (@policereport_number, @policereport_date, @policereport_time, @policereport_location, @policereport_purpose, @policereport_document, @policereport_name, @case_id, @policestation_id);
        `);

      // --- commit และตอบกลับ ---
      await transaction.commit();
      return res.status(200).json({
        success: true,
        message: 'บันทึกข้อมูลสำเร็จ',
        case_id,
      });
    } catch (err) {
      console.error('POST /cases error:', err);
      if (transaction && transaction.isActive) {
        try {
          await transaction.rollback();
        } catch (rbErr) {
          console.error('Rollback error:', rbErr);
        }
      }
      return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', error: err.message });
    }
  }
);


const closedIn = () => `N'พบเจอ - ปลอดภัย', N'พบเจอ - เสียชีวิต', N'ปิดเคส'`;

// ==========================================
// ดึงเคส
// ==========================================
router.get('/cases', async (req, res) => {
    try {

        const search = (req.query.search || '').trim();
        const status = (req.query.status || '').trim();
        const priority = (req.query.priority || '').trim();
        const province = (req.query.province || '').trim();

        const pool = await sql.connect(dbConfig);
        const request = pool.request();

        let whereConditions = [];

        // ==========================================
        // SEARCH ชื่อ / รหัสเคส / เลขบัตร
        // ==========================================
        if (search !== '') {

            request.input(
                'search',
                sql.NVarChar(255),
                `%${search}%`
            );

            whereConditions.push(`
                (
                    m.missingperson_name LIKE @search

                    OR CAST(c.case_id AS NVARCHAR(50))
                       LIKE @search

                    OR CAST(m.missingperson_identity AS NVARCHAR(MAX))
                       LIKE @search
                )
            `);
        }


        // ==========================================
        //  STATUS
        // ==========================================
        if (status !== '') {

            if (status === 'active') {

                whereConditions.push(`
                    c.case_latest_status IN (
                        'รับแจ้งเหตุ',
                        'กำลังตรวจสอบข้อมูล',
                        'กำลังค้นหา - ประกาศโพสต์หา',
                        'กลับมาค้นหาอีกครั้ง'
                    )
                `);

            } else if (status === 'closed') {

                whereConditions.push(`
                    c.case_latest_status IN (
                        'พบเจอ - ปลอดภัย',
                        'พบเจอ - เสียชีวิต',
                        'ปิดเคส'
                    )
                `);

            } else {

                request.input(
                    'status',
                    sql.NVarChar(100),
                    status
                );

                whereConditions.push(`
                    c.case_latest_status = @status
                `);
            }
        }


        // ==========================================
        //  PRIORITY
        // ==========================================
        if (priority !== '') {

            if (priority === 'high') {

                whereConditions.push(`
                    c.case_priority IN (
                        'เร่งด่วนมาก',
                        'high'
                    )
                `);

            } else if (priority === 'medium') {

                whereConditions.push(`
                    c.case_priority IN (
                        'เร่งด่วน',
                        'medium'
                    )
                `);

            } else {

                request.input(
                    'priority',
                    sql.NVarChar(100),
                    priority
                );

                whereConditions.push(`
                    c.case_priority = @priority
                `);
            }
        }


        // ==========================================
        //  PROVINCE
        // ==========================================
        if (province !== '') {

            request.input(
                'province',
                sql.NVarChar(100),
                province
            );

            whereConditions.push(`
                ls.Last_Seen_province = @province
            `);
        }


        // ==========================================
        // รวม WHERE
        // ==========================================
        let whereSQL = '';

        if (whereConditions.length > 0) {

            whereSQL = `
                WHERE
                    ${whereConditions.join('\n AND ')}
            `;
        }

        const result = await request.query(`

            SET NOCOUNT ON;

            SELECT
                c.case_id,
                c.case_priority,
                c.case_latest_status,
                c.case_missing_reason,
                c.case_received_date,
                c.case_notes,
                c.case_relation_to_missing,
                c.staff_id,

                m.missingperson_title,
                m.missingperson_name,
                m.missingperson_gender,
                m.missingperson_birthday,
                m.missingperson_age,
                m.missingperson_race,

                ls.Last_Seen_place,
                ls.Last_Seen_subdistrict,
                ls.Last_Seen_district,
                ls.Last_Seen_province,
                ls.Last_Seen_date,

                ch.character_image_url,

                ps.policestation_name

            FROM MissingCase c

            JOIN MissingPerson m
                ON m.missingperson_id = c.missingperson_id

            -- ==========================================
            -- Last Seen
            -- ==========================================
            OUTER APPLY (
                SELECT TOP 1 l.*
                FROM Last_Seen_Log l

                JOIN StatusLog sl
                    ON sl.log_id = l.log_id

                WHERE sl.case_id = c.case_id

                ORDER BY l.log_id ASC
            ) ls

            -- ==========================================
            -- Character
            -- ==========================================
            OUTER APPLY (
                SELECT TOP 1 ch.*
                FROM Missingperson_Character_Log ch

                JOIN StatusLog sl
                    ON sl.log_id = ch.log_id

                WHERE sl.case_id = c.case_id

                ORDER BY ch.log_id ASC
            ) ch

            -- ==========================================
            -- Police Station
            -- ==========================================
            LEFT JOIN PoliceStation ps
                ON ps.policestation_id = c.police_station_id

            ${whereSQL}

            ORDER BY c.case_received_date DESC;

        `);

        // ==========================================
        // Response
        // ==========================================
        res.json(result.recordset);

    } catch (err) {

        console.error(
            'GET /cases Error:',
            err.message
        );

        res.status(500).json({
            success: false,
            message: 'ไม่สามารถดึงรายการเคสได้',
            error: err.message
        });
    }
});

// ==========================================
// 🚀 API 2: รายละเอียดเคส  
// ==========================================
router.get('/cases/:id', async (req, res) => {
    try {
        const caseId = parseInt(req.params.id, 10);
        if (isNaN(caseId)) {
            return res.status(400).json({ success: false, message: 'รหัสเคสไม่ถูกต้อง' });
        }

        const pool = await sql.connect(dbConfig);

        // --- ข้อมูลหลักของเคส ---
        const caseResult = await pool.request()
            .input('case_id', sql.Int, caseId)
            .query(`
                SET NOCOUNT ON;
                SELECT
                    c.case_id, c.case_priority, c.case_latest_status, c.case_missing_reason,
                    c.case_received_date, c.case_notes, c.case_relation_to_missing, c.staff_id,
                    m.missingperson_title, m.missingperson_name, m.missingperson_gender,
                    m.missingperson_birthday, m.missingperson_age, m.missingperson_race, m.missingperson_identity,
                    ls.Last_Seen_place, ls.Last_Seen_subdistrict, ls.Last_Seen_district,
                    ls.Last_Seen_province, ls.Last_Seen_date, ls.Last_Seen_time,
                    ch.character_image_url, ch.character_skin_color, ch.character_body_shape,
                    ch.character_hair_style, ch.character_hair_color, ch.character_height_cm,
                    ps.policestation_name, ps.policestation_province, ps.policestation_phone
                FROM MissingCase c
                JOIN MissingPerson m ON m.missingperson_id = c.missingperson_id
                OUTER APPLY (
                    SELECT TOP 1 l.*
                    FROM Last_Seen_Log l
                    JOIN StatusLog sl ON sl.log_id = l.log_id
                    WHERE sl.case_id = c.case_id
                    ORDER BY l.log_id ASC
                ) ls
                OUTER APPLY (
                    SELECT TOP 1 ch.*
                    FROM Missingperson_Character_Log ch
                    JOIN StatusLog sl ON sl.log_id = ch.log_id
                    WHERE sl.case_id = c.case_id
                    ORDER BY ch.log_id ASC
                ) ch
                LEFT JOIN PoliceStation ps ON ps.policestation_id = c.police_station_id
                WHERE c.case_id = @case_id;
            `);

        if (caseResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบเคสนี้ในระบบ' });
        }

        // --- ประวัติการเปลี่ยนสถานะทั้งหมด (เรียงเก่า → ใหม่) ---
        const logs = await pool.request()
            .input('case_id', sql.Int, caseId)
            .query(`
                SET NOCOUNT ON;
                SELECT log_id, case_id, log_case_status, log_logged_by, log_description, log_logged_date
                FROM StatusLog
                WHERE case_id = @case_id
                ORDER BY log_id ASC;
            `);

        // --- ใบแจ้งความทั้งหมดของเคส ---
        const reports = await pool.request()
            .input('case_id', sql.Int, caseId)
            .query(`
                SET NOCOUNT ON;
                SELECT policereport_id, policereport_number, policereport_date, policereport_time,
                       policereport_location, policereport_purpose, policereport_document, policereport_name
                FROM PoliceReport
                WHERE case_id = @case_id
                ORDER BY policereport_id ASC;
            `);

        res.json({
            success: true,
            case: caseResult.recordset[0],
            status_logs: logs.recordset,
            police_reports: reports.recordset
        });
    } catch (err) {
        console.error('GET /cases/:id Error:', err.message);
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงรายละเอียดเคสได้', error: err.message });
    }
});

// ==========================================
// 🚀 API 3: สถิติสรุปสำหรับหน้าแรก 
// ==========================================
router.get('/stats', async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SET NOCOUNT ON;
            SELECT
                (SELECT COUNT(*) FROM MissingCase) AS total,
                (SELECT COUNT(*) FROM MissingCase
                 WHERE case_latest_status NOT IN (${closedIn()})) AS active,
                (SELECT COUNT(*) FROM MissingCase
                 WHERE case_latest_status IN (${closedIn()})) AS resolved,
                (SELECT COUNT(*) FROM Clue) AS pending_clues;
        `);
        const row = result.recordset[0];
        res.json({
            total: row.total,
            active: row.active,
            resolved: row.resolved,
            pending_clues: row.pending_clues
        });
    } catch (err) {
        console.error('GET /stats Error:', err.message);
        res.status(500).json({ success: false, message: 'ไม่สามารถดึงสถิติได้', error: err.message });
    }
});

// ======================================================
// AUTO STATUS WORKFLOW HELPER
// ======================================================

async function changeCaseStatus({
  caseId,
  newStatus,
  loggedBy = 'System',
  description = '',
  transaction
}) {
  // ตรวจสอบสถานะ
  if (!Object.values(CASE_STATUSES).includes(newStatus)) {
    throw new Error(`สถานะไม่ถูกต้อง: ${newStatus}`);
  }

  // ดึงสถานะปัจจุบัน
  const currentResult = await transaction.request()
    .input('case_id', sql.Int, caseId)
    .query(`
      SELECT
        case_id,
        case_latest_status
      FROM MissingCase
      WHERE case_id = @case_id
    `);

  if (currentResult.recordset.length === 0) {
    throw new Error('ไม่พบเคสที่ต้องการเปลี่ยนสถานะ');
  }

  const currentStatus =
    currentResult.recordset[0].case_latest_status;

  // ถ้าสถานะเหมือนเดิม
  if (currentStatus === newStatus) {
    throw new Error(`เคสนี้มีสถานะเป็น "${newStatus}" อยู่แล้ว`);
  }

  // ==================================================
  // ตรวจสอบ Workflow
  // ==================================================

  const allowedTransitions = {
    [CASE_STATUSES.RECEIVED]: [
      CASE_STATUSES.REVIEWING
    ],

    [CASE_STATUSES.REVIEWING]: [
      CASE_STATUSES.SEARCHING
    ],

    [CASE_STATUSES.SEARCHING]: [
      CASE_STATUSES.FOUND_SAFE,
      CASE_STATUSES.FOUND_DEAD
    ],

    [CASE_STATUSES.FOUND_SAFE]: [
      CASE_STATUSES.CLOSED
    ],

    [CASE_STATUSES.FOUND_DEAD]: [
      CASE_STATUSES.CLOSED
    ],

    [CASE_STATUSES.CLOSED]: [
      CASE_STATUSES.RESUMED
    ],

    [CASE_STATUSES.RESUMED]: [
      CASE_STATUSES.SEARCHING
    ]
  };

  const allowedNextStatuses =
    allowedTransitions[currentStatus] || [];

  if (!allowedNextStatuses.includes(newStatus)) {
    throw new Error(
      `ไม่สามารถเปลี่ยนสถานะจาก "${currentStatus}" เป็น "${newStatus}"`
    );
  }

  // ==================================================
  // UPDATE MissingCase
  // ==================================================

  await transaction.request()
    .input('case_id', sql.Int, caseId)
    .input('new_status', sql.NVarChar, newStatus)
    .query(`
      UPDATE MissingCase
      SET case_latest_status = @new_status
      WHERE case_id = @case_id
    `);

  // ==================================================
  // INSERT StatusLog
  // ==================================================

  const logResult = await transaction.request()
    .input('case_id', sql.Int, caseId)
    .input('status', sql.NVarChar, newStatus)
    .input('logged_by', sql.NVarChar, loggedBy)
    .input('description', sql.NVarChar, description)
    .query(`
      INSERT INTO StatusLog
      (
        case_id,
        log_case_status,
        log_logged_by,
        log_description
      )
      OUTPUT INSERTED.log_id
      VALUES
      (
        @case_id,
        @status,
        @logged_by,
        @description
      )
    `);

  const logId = logResult.recordset[0].log_id;

  return {
    previous_status: currentStatus,
    current_status: newStatus,
    log_id: logId
  };
}

// ======================================================
// AUTO STATUS WORKFLOW ROUTES
// ======================================================

// 1. เริ่มตรวจสอบข้อมูล
router.post('/cases/:id/start-review', async (req, res) => {
  const caseId = parseInt(req.params.id);

  if (Number.isNaN(caseId)) {
    return res.status(400).json({
      success: false,
      message: 'case_id ไม่ถูกต้อง'
    });
  }

 const pool = await sql.connect(dbConfig);
const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const result = await changeCaseStatus({
      caseId,
      newStatus: CASE_STATUSES.REVIEWING,
      loggedBy: req.body.logged_by || 'System',
      description: req.body.description ||
        'เจ้าหน้าที่เริ่มตรวจสอบข้อมูล',
      transaction
    });

    await transaction.commit();

    res.json({
      success: true,
      message: 'เริ่มตรวจสอบข้อมูลแล้ว',
      case_id: caseId,
      ...result
    });

  } catch (error) {
    try {
      await transaction.rollback();
    } catch (_) {}

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// 2. เริ่มค้นหา
router.post('/cases/:id/start-search', async (req, res) => {
  const caseId = parseInt(req.params.id);

  if (Number.isNaN(caseId)) {
    return res.status(400).json({
      success: false,
      message: 'case_id ไม่ถูกต้อง'
    });
  }

  const pool = await sql.connect(dbConfig);
const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const result = await changeCaseStatus({
      caseId,
      newStatus: CASE_STATUSES.SEARCHING,
      loggedBy: req.body.logged_by || 'System',
      description: req.body.description ||
        'เจ้าหน้าที่เริ่มดำเนินการค้นหาและประกาศโพสต์หา',
      transaction
    });

    await transaction.commit();

    res.json({
      success: true,
      message: 'เริ่มค้นหาแล้ว',
      case_id: caseId,
      ...result
    });

  } catch (error) {
    try {
      await transaction.rollback();
    } catch (_) {}

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// 3. พบเจอ - ปลอดภัย
router.post('/cases/:id/found-safe', async (req, res) => {
  const caseId = parseInt(req.params.id);

  if (Number.isNaN(caseId)) {
    return res.status(400).json({
      success: false,
      message: 'case_id ไม่ถูกต้อง'
    });
  }

  const pool = await sql.connect(dbConfig);
const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const result = await changeCaseStatus({
      caseId,
      newStatus: CASE_STATUSES.FOUND_SAFE,
      loggedBy: req.body.logged_by || 'System',
      description: req.body.description ||
        'พบตัวบุคคลแล้วและปลอดภัย',
      transaction
    });

    await transaction.commit();

    res.json({
      success: true,
      message: 'อัปเดตสถานะพบเจอ - ปลอดภัยแล้ว',
      case_id: caseId,
      ...result
    });

  } catch (error) {
    try {
      await transaction.rollback();
    } catch (_) {}

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// 4. พบเจอ - เสียชีวิต
router.post('/cases/:id/found-dead', async (req, res) => {
  const caseId = parseInt(req.params.id);

  if (Number.isNaN(caseId)) {
    return res.status(400).json({
      success: false,
      message: 'case_id ไม่ถูกต้อง'
    });
  }

  const pool = await sql.connect(dbConfig);
const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const result = await changeCaseStatus({
      caseId,
      newStatus: CASE_STATUSES.FOUND_DEAD,
      loggedBy: req.body.logged_by || 'System',
      description: req.body.description ||
        'พบตัวบุคคลแล้วและเสียชีวิต',
      transaction
    });

    await transaction.commit();

    res.json({
      success: true,
      message: 'อัปเดตสถานะพบเจอ - เสียชีวิตแล้ว',
      case_id: caseId,
      ...result
    });

  } catch (error) {
    try {
      await transaction.rollback();
    } catch (_) {}

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// 5. ปิดเคส
router.post('/cases/:id/close', async (req, res) => {
  const caseId = parseInt(req.params.id);

  if (Number.isNaN(caseId)) {
    return res.status(400).json({
      success: false,
      message: 'case_id ไม่ถูกต้อง'
    });
  }

  const pool = await sql.connect(dbConfig);
const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const result = await changeCaseStatus({
      caseId,
      newStatus: CASE_STATUSES.CLOSED,
      loggedBy: req.body.logged_by || 'System',
      description: req.body.description ||
        'ปิดเคส',
      transaction
    });

    await transaction.commit();

    res.json({
      success: true,
      message: 'ปิดเคสสำเร็จ',
      case_id: caseId,
      ...result
    });

  } catch (error) {
    try {
      await transaction.rollback();
    } catch (_) {}

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// 6. กลับมาค้นหาอีกครั้ง
router.post('/cases/:id/resume-search', async (req, res) => {
  const caseId = parseInt(req.params.id);

  if (Number.isNaN(caseId)) {
    return res.status(400).json({
      success: false,
      message: 'case_id ไม่ถูกต้อง'
    });
  }

  const pool = await sql.connect(dbConfig);
const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const result = await changeCaseStatus({
      caseId,
      newStatus: CASE_STATUSES.RESUMED,
      loggedBy: req.body.logged_by || 'System',
      description: req.body.description ||
        'เปิดการค้นหาอีกครั้ง',
      transaction
    });

    await transaction.commit();

    res.json({
      success: true,
      message: 'กลับมาค้นหาอีกครั้งแล้ว',
      case_id: caseId,
      ...result
    });

  } catch (error) {
    try {
      await transaction.rollback();
    } catch (_) {}

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// ==========================================
// 🔎 API : รายละเอียดเคส
// GET /api/cases/:id
// ==========================================
router.get('/cases/:id', async (req, res) => {
    try {

        const caseId = Number(req.params.id);

        if (!Number.isInteger(caseId)) {
            return res.status(400).json({
                success: false,
                message: 'case_id ไม่ถูกต้อง'
            });
        }

        const pool = await sql.connect(dbConfig);

        const request = pool.request();

        request.input(
            'case_id',
            sql.Int,
            caseId
        );

        const result = await request.query(`

            SET NOCOUNT ON;

            SELECT
                c.case_id,
                c.case_priority,
                c.case_latest_status,
                c.case_missing_reason,
                c.case_received_date,
                c.case_notes,
                c.case_relation_to_missing,
                c.staff_id,

                -- ==========================
                -- Missing Person
                -- ==========================
                m.missingperson_id,
                m.missingperson_title,
                m.missingperson_name,
                m.missingperson_gender,
                m.missingperson_birthday,
                m.missingperson_age,
                m.missingperson_race,
                m.missingperson_identity,

                -- ==========================
                -- Last Seen
                -- ==========================
                ls.Last_Seen_place,
                ls.Last_Seen_subdistrict,
                ls.Last_Seen_district,
                ls.Last_Seen_province,
                ls.Last_Seen_date,
                ls.Last_Seen_time,

                -- ==========================
                -- Character
                -- ==========================
                ch.character_image_url,
                ch.character_skin_color,
                ch.character_body_shape,
                ch.character_hair_style,
                ch.character_hair_color,
                ch.character_height_cm,

                -- ==========================
                -- Police Station
                -- ==========================
                ps.policestation_name

            FROM MissingCase c

            JOIN MissingPerson m
                ON m.missingperson_id = c.missingperson_id

            OUTER APPLY (
                SELECT TOP 1 l.*
                FROM Last_Seen_Log l

                JOIN StatusLog sl
                    ON sl.log_id = l.log_id

                WHERE sl.case_id = c.case_id

                ORDER BY l.log_id ASC
            ) ls

            OUTER APPLY (
                SELECT TOP 1 ch.*
                FROM Missingperson_Character_Log ch

                JOIN StatusLog sl
                    ON sl.log_id = ch.log_id

                WHERE sl.case_id = c.case_id

                ORDER BY ch.log_id ASC
            ) ch

            LEFT JOIN PoliceStation ps
                ON ps.policestation_id = c.police_station_id

            WHERE c.case_id = @case_id;

        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบข้อมูลเคส'
            });
        }

        res.json(result.recordset[0]);

    } catch (err) {

        console.error(
            'GET /cases/:id Error:',
            err.message
        );

        res.status(500).json({
            success: false,
            message: 'ไม่สามารถดึงรายละเอียดเคสได้',
            error: err.message
        });
    }
});


// ------------------------------------------
// GET /api/cases/:id/status-logs
// ------------------------------------------
router.get('/cases/:id/status-logs', async (req, res) => {
  try {
    const case_id = parseInt(req.params.id, 10);

    if (isNaN(case_id)) {
      return res.status(400).json({
        success: false,
        message: 'case_id ไม่ถูกต้อง'
      });
    }

    const pool = await sql.connect(dbConfig);

    // เช็คก่อนว่าเคสมีอยู่จริง
    const caseResult = await pool
      .request()
      .input('case_id', sql.Int, case_id)
      .query(`
        SELECT case_id, case_latest_status
        FROM MissingCase
        WHERE case_id = @case_id
      `);

    if (caseResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบเคสนี้'
      });
    }

    // ดึงประวัติ Status
    const result = await pool
      .request()
      .input('case_id', sql.Int, case_id)
      .query(`
        SELECT
          log_id,
          case_id,
          log_case_status,
          log_logged_by,
          log_description,
          log_logged_date
        FROM StatusLog
        WHERE case_id = @case_id
        ORDER BY log_logged_date ASC, log_id ASC
      `);

    return res.status(200).json({
      success: true,
      case_id: case_id,
      current_status: caseResult.recordset[0].case_latest_status,
      total: result.recordset.length,
      status_logs: result.recordset
    });

  } catch (err) {
    console.error('GET /cases/:id/status-logs error:', err);

    return res.status(500).json({
      success: false,
      message: 'ไม่สามารถดึงประวัติสถานะได้',
      error: err.message
    });
  }
});





module.exports = router;


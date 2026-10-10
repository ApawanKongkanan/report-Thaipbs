const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
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
    // ถ้าเจอ .env ในโฟลเดอร์ Backend ให้โหลดมาใช้
    require('dotenv').config({ path: envPathBackend });
    console.log("✅ Loaded .env from Backend folder:", envPathBackend);
} else if (fs.existsSync(envPathRoot)) {
    // ถ้าเจอ .env ในโฟลเดอร์ Root ให้โหลดมาใช้
    require('dotenv').config({ path: envPathRoot });
    console.log("✅ Loaded .env from Root folder:", envPathRoot);
} else {
    // ถ้าระบบหาไฟล์ .env ไม่เจอเลยในทั่งสองที่ จะเตือนบอกล่วงหน้าตรงนี้
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

// 2. ฟังก์ชันอัปโหลดขึ้น Azure Blob (เพิ่มระบบตรวจสอบตัวแปรป้องกันการแครช)
async function uploadFileToBlob(file) {
    if (!file) return null;
    
    // ดึงค่าการเชื่อมต่อ Azure จากไฟล์ .env
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
    // เช็คว่าตั้งค่า .env ไว้ครบไหม ถ้าไม่ครบให้แจ้ง Error
    if (!connectionString || !containerName) {
        throw new Error(`❌ ตัวแปรสำหรับ Azure Storage ไม่ครบถ้วนใน .env`);
    }

    // สร้าง Client สำหรับเชื่อมต่อกับ Azure Storage และ Container ที่กำหนด
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    
    // 🛠️ จุดแก้ไขหลัก: ดึงเฉพาะนามสกุลไฟล์ (.jpg / .png / .webp) 
    const fileExtension = path.extname(file.originalname) || '.jpg';
    // ใช้ Timestamp (เวลาปัจจุบัน) ผสมกับตัวเลขสุ่ม (1000-9999) เป็นชื่อไฟล์แทน 
    // เพื่อป้องกัน Error เวลาที่ชื่อไฟล์ต้นฉบับเป็นภาษาไทย หรือมีอักขระแปลกๆ 
    const blobName = `${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}${fileExtension}`;
    // เตรียมการอัปโหลดและส่ง Buffer ของไฟล์ขึ้น Azure
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(file.buffer);
    // คืนค่า URL ของไฟล์ที่อัปโหลดเสร็จแล้ว
    return blockBlobClient.url; 
}

// ==========================================
// 🚀 API 1: อ่านใบแจ้งความ 
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
        
        // 🌟 อัปเดต Prompt: บังคับให้ AI สกัดวัตถุประสงค์/รายละเอียดการแจ้งความเพิ่มเข้ามาด้วย
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
            
            // 🌟 แก้ไข 1: ลบ || ที่พิมพ์เกินออก เพื่อให้ดักจับยศตำรวจและชื่อได้อย่างแม่นยำ
            const officerMatch = rawContent.match(/(?:พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.)\s*([ก-๙]+\s+[ก-๙]+)/);
            
            // 🌟 แก้ไข 2: ดักจับข้อความที่เป็นเนื้อหา แล้วเก็บไว้ทั้งหมดโดยไม่ตัดทิ้ง
            const purposeMatch = rawContent.match(/(?:แจ้งว่า|ร้องทุกข์ว่า|รายละเอียด|บันทึกรับคำร้องทุกข์)\s*(.*)/s);
            let fallbackPurpose = "แจ้งความคนหาย/ร้องทุกข์คดี";
            
            if (purposeMatch) {
                // ล้าง tag html ออก และลบคำสั่ง substring() ออกไปเพื่อให้ได้ข้อความเต็ม
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
router.post('/cases', upload.fields([
    { name: 'missing_image', maxCount: 1 },
    { name: 'police_document', maxCount: 1 }
]), async (req, res) => {
    let transaction;
    let pool;
    try {
        const body = req.body;
        
        // 🌟 ปล่อย Hard code รหัสผ่านไว้ตามเดิมเพื่อความง่ายในการทดสอบ
        const hashedPassword = "password123";
        
        let causesArray = [];
        try { causesArray = JSON.parse(body.causes || '[]'); } catch(e) {}
        const cleanCausesText = causesArray.map(c => `${c.rank}. ${c.name}`).join(', ');

        const missingImageUrl = await uploadFileToBlob(req.files['missing_image'] ? req.files['missing_image'][0] : null);
        const policeDocUrl = await uploadFileToBlob(req.files['police_document'] ? req.files['police_document'][0] : null);

        pool = await sql.connect(dbConfig);
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const generateId = () => Math.floor(100000 + Math.random() * 900000);
        const people_id = generateId();
        const missingperson_id = generateId();
        const police_station_id = generateId();
        const case_id = generateId();
        const log_id = generateId();
        const report_id = generateId();

        // 🌟 แปลงข้อมูลที่อาจเป็นค่าว่างให้ปลอดภัย
        const missingAge = body.missing_age && body.missing_age.trim() !== '' ? parseInt(body.missing_age) : null;
        const missingHeight = body.missing_height && body.missing_height.trim() !== '' ? parseInt(body.missing_height) : null;
        const missingBirthdate = body.missing_birthdate && body.missing_birthdate.trim() !== '' ? new Date(body.missing_birthdate) : null;
        const lastSeenDate = body.last_seen_date && body.last_seen_date.trim() !== '' ? new Date(body.last_seen_date) : null;

        // 🌟 จัดการ Identity (ป้องกันคำว่า undefined โผล่ใน Database)
        const finalReporterIdentity = `${body.reporter_id_type || 'ไม่ระบุ'}: ${body.reporter_id_number || '-'}`;
        const finalMissingIdentity = `${body.missing_id_type || 'ไม่ระบุ'}: ${body.missing_id_number || '-'}`;

        // --- 1. People ---
        const requestPeople = new sql.Request(transaction);
        await requestPeople
            .input('people_id', sql.Int, people_id)
            .input('people_title', sql.NVarChar, body.reporter_title || '')
            .input('people_name', sql.NVarChar, body.reporter_name || '')
            .input('people_phone', sql.NVarChar, body.reporter_phone || '')
            .input('people_identity', sql.NVarChar, finalReporterIdentity)
            .input('people_account', sql.NVarChar, body.reporter_phone || '')
            .input('people_password_hash', sql.NVarChar, hashedPassword) // ใช้ค่า Hard code
            .query(`INSERT INTO People (people_id, people_title, people_name, people_phone, people_identity, people_account, people_password_hash) 
                    VALUES (@people_id, @people_title, @people_name, @people_phone, @people_identity, @people_account, @people_password_hash)`);

        // --- 2. MissingPerson ---
        const requestMissingPerson = new sql.Request(transaction);
        await requestMissingPerson
            .input('missingperson_id', sql.Int, missingperson_id)
            .input('missingperson_title', sql.NVarChar, body.missing_title || '')
            .input('missingperson_name', sql.NVarChar, body.missing_name || '')
            .input('missingperson_identity', sql.NVarChar, finalMissingIdentity)
            .input('missingperson_gender', sql.NVarChar, body.missing_gender || 'ไม่ระบุ')
            .input('missingperson_birthday', sql.Date, missingBirthdate)
            .input('missingperson_age', sql.Int, missingAge) 
            .input('missingperson_race', sql.NVarChar, body.missing_nationality || 'ไทย')
            .query(`INSERT INTO MissingPerson (missingperson_id, missingperson_title, missingperson_name, missingperson_gender, missingperson_birthday, missingperson_age, missingperson_race, missingperson_identity) 
                    VALUES (@missingperson_id, @missingperson_title, @missingperson_name, @missingperson_gender, @missingperson_birthday, @missingperson_age, @missingperson_race, @missingperson_identity)`);

        // --- 3. PoliceStation ---
        const requestStation = new sql.Request(transaction);
        const stationResult = await requestStation
            .input('policestation_id', sql.Int, police_station_id)
            .input('policestation_name', sql.NVarChar, body.police_station || 'ไม่ระบุ สน/สภ')
            .input('policestation_province', sql.NVarChar, body.police_province || 'ไม่ระบุ')
            .input('policestation_phone', sql.NVarChar, '191')
            .query(`
                SET NOCOUNT ON;
                DECLARE @actual_station_id INT;
                SELECT @actual_station_id = policestation_id FROM PoliceStation WHERE policestation_name = @policestation_name;
                
                IF @actual_station_id IS NULL
                BEGIN
                    INSERT INTO PoliceStation (policestation_id, policestation_name, policestation_province, policestation_phone)
                    VALUES (@policestation_id, @policestation_name, @policestation_province, @policestation_phone);
                    SELECT @policestation_id AS final_station_id;
                END
                ELSE
                BEGIN
                    SELECT @actual_station_id AS final_station_id;
                END
            `);

        const final_police_station_id = stationResult.recordset[0].final_station_id;

        // --- 4. MissingCase ---
        const requestCase = new sql.Request(transaction);
        await requestCase
            .input('case_id', sql.Int, case_id)
            .input('case_priority', sql.NVarChar, body.urgency_level || 'ปกติ')
            .input('case_latest_status', sql.NVarChar, 'กำลังดำเนินการตรวจสอบขั้นต้น')
            .input('case_missing_reason', sql.NVarChar, cleanCausesText)
            .input('case_received_date', sql.DateTime, new Date())
            .input('case_notes', sql.NVarChar, '')
            .input('case_relation_to_missing', sql.NVarChar, body.reporter_relationship === 'อื่นๆ' ? body.reporter_relationship_other : (body.reporter_relationship || ''))
            .input('people_id', sql.Int, people_id)
            .input('missingperson_id', sql.Int, missingperson_id)
            .input('police_station_id', sql.Int, final_police_station_id)
            .query(`INSERT INTO MissingCase (case_id, case_priority, case_latest_status, case_missing_reason, case_received_date, case_notes, case_relation_to_missing, people_id, missingperson_id, police_station_id) 
                    VALUES (@case_id, @case_priority, @case_latest_status, @case_missing_reason, @case_received_date, @case_notes, @case_relation_to_missing, @people_id, @missingperson_id, @police_station_id)`);

        // --- 5. StatusLog ---
        const requestLog = new sql.Request(transaction);
        await requestLog
            .input('log_id', sql.Int, log_id)
            .input('case_id', sql.Int, case_id)
            .input('log_case_status', sql.NVarChar, 'รับเรื่องแจ้งเหตุ')
            .input('log_logged_by', sql.NVarChar, body.reporter_name || 'System')
            .input('log_description', sql.NVarChar, 'ผู้แจ้งสร้างเคสคนหายเข้าระบบตรวจสอบผ่านพอร์ทัลหลัก')
            .query(`INSERT INTO StatusLog (log_id, case_id, log_case_status, log_logged_by, log_description) 
                    VALUES (@log_id, @case_id, @log_case_status, @log_logged_by, @log_description)`);

        // --- 6. Last_Seen_Log ---
        const requestLastSeen = new sql.Request(transaction);
        await requestLastSeen
            .input('log_id', sql.Int, log_id) 
            .input('Last_Seen_date', sql.Date, lastSeenDate)
            .input('Last_Seen_time', sql.VarChar, body.time_start || '00:00') 
            .input('Last_Seen_place', sql.NVarChar, body.last_seen_place || '')
            .input('Last_Seen_subdistrict', sql.NVarChar, body.subdistrict || '')
            .input('Last_Seen_district', sql.NVarChar, body.district || '')
            .input('Last_Seen_province', sql.NVarChar, body.province || '')
            .query(`INSERT INTO Last_Seen_Log (log_id, Last_Seen_date, Last_Seen_time, Last_Seen_place, Last_Seen_subdistrict, Last_Seen_district, Last_Seen_province) 
                    VALUES (@log_id, @Last_Seen_date, @Last_Seen_time, @Last_Seen_place, @Last_Seen_subdistrict, @Last_Seen_district, @Last_Seen_province)`);

        // --- 7. Missingperson_Character_Log ---
        const requestCharacter = new sql.Request(transaction);
        await requestCharacter
            .input('log_id', sql.Int, log_id)
            .input('character_image_url', sql.NVarChar, missingImageUrl || '')
            .input('character_skin_color', sql.NVarChar, body.skin_color === 'อื่นๆ' ? (body.skin_color_other || '') : (body.skin_color || 'ไม่ระบุ'))
            .input('character_body_shape', sql.NVarChar, body.body_shape === 'อื่นๆ' ? (body.body_shape_other || '') : (body.body_shape || 'ไม่ระบุ'))
            .input('character_hair_style', sql.NVarChar, body.hair_style === 'อื่นๆ' ? (body.hair_style_other || '') : (body.hair_style || 'ไม่ระบุ'))
            .input('character_hair_color', sql.NVarChar, 'ไม่ระบุ')
            .input('character_height_cm', sql.Int, missingHeight)
            .query(`INSERT INTO Missingperson_Character_Log (log_id, character_image_url, character_skin_color, character_body_shape, character_hair_style, character_hair_color, character_height_cm) 
                    VALUES (@log_id, @character_image_url, @character_skin_color, @character_body_shape, @character_hair_style, @character_hair_color, @character_height_cm)`);

        // --- 8. PoliceReport ---
        let reportDate = new Date();
        if (body.policereport_date && body.policereport_date.trim() !== '') {
            const parsedDate = new Date(body.policereport_date);
            if (!isNaN(parsedDate)) { reportDate = parsedDate; }
        }

        const requestPoliceReport = new sql.Request(transaction);
        await requestPoliceReport
            .input('policereport_id', sql.Int, report_id)
            .input('policereport_number', sql.NVarChar, body.policereport_number || `PR-${generateId()}`) 
            .input('policereport_date', sql.DateTime, reportDate) 
            .input('policereport_time', sql.VarChar, body.policereport_time || '00:00')
            .input('policereport_location', sql.NVarChar, body.policereport_location || body.police_station || 'ไม่ระบุ')
            .input('policereport_purpose', sql.NVarChar, body.policereport_purpose || 'แจ้งความคนหาย')
            .input('policereport_document', sql.NVarChar, policeDocUrl || '')
            .input('policereport_name', sql.NVarChar, body.policereport_name || 'ไม่ระบุชื่อ')
            .input('case_id', sql.Int, case_id)
            .input('policestation_id', sql.Int, final_police_station_id)
            .query(`INSERT INTO PoliceReport (policereport_id, policereport_number, policereport_date, policereport_time, policereport_location, policereport_purpose, policereport_document, policereport_name, case_id, policestation_id) 
                    VALUES (@policereport_id, @policereport_number, @policereport_date, @policereport_time, @policereport_location, @policereport_purpose, @policereport_document, @policereport_name, @case_id, @policestation_id)`);

        await transaction.commit();
        res.status(200).json({ success: true, message: 'บันทึกข้อมูลสำเร็จ', case_id: case_id });

    } catch (error) {
        console.error('Transaction Error! Rolling back...', error);
        if (transaction && transaction.isActive) {
            try { await transaction.rollback(); } catch(e) { console.error('Rollback failed:', e); }
        }
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', error: error.message });
    }
});


// --- API: สำหรับชาวบ้านเช็คสถานะเคสคนหาย ---
router.post('/track-status', async (req, res) => {
    try {
        // รับค่าเบอร์โทรศัพท์ และ เลขที่เคส จากหน้าเว็บ
        const { phone, case_id } = req.body;
        
        // ตรวจสอบเบื้องต้นว่ากรอกข้อมูลมาครบไหม
        if (!phone || !case_id) {
            return res.status(400).json({ success: false, message: "กรุณากรอกเบอร์โทรศัพท์และหมายเลขเคสให้ครบถ้วน" });
        }

        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('phone', sql.NVarChar, phone.trim())
            .input('case_id', sql.Int, case_id)
            // JOIN ตาราง MissingCase กับ People เพื่อเช็คว่าเบอร์โทรตรงกับคนแจ้งเคสนี้หรือไม่
            .query(`
                SELECT 
                    c.case_id, 
                    c.case_latest_status, 
                    c.case_received_date, 
                    p.people_name,
                    mp.missingperson_name
                FROM MissingCase c
                INNER JOIN People p ON c.people_id = p.people_id
                LEFT JOIN MissingPerson mp ON c.missingperson_id = mp.missingperson_id
                WHERE p.people_phone = @phone AND c.case_id = @case_id
            `);

        // ถ้าค้นหาเจอ (รหัสเคสและเบอร์โทรตรงกัน)
        if (result.recordset.length > 0) {
            return res.json({ 
                success: true, 
                message: "พบข้อมูลเคส", 
                data: result.recordset[0] 
            });
        }

        // ถ้าข้อมูลไม่ตรง หรือไม่พบข้อมูล
        return res.status(404).json({ success: false, message: "ไม่พบข้อมูลเคส หรือเบอร์โทรศัพท์ไม่ถูกต้อง" });

    } catch (err) {
        console.error("Tracking Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// บันทึกคำสั่งนี้ลงไฟล์ฝั่ง Backend ของคุณเพื่อเป็นท่อส่งข้อมูลให้หน้าเว็บ
router.get('/cases', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        // ผมปรับให้ดึง StatusLog ล่าสุดของเคสนั้นมาโดยไม่อิงเงื่อนไขชื่อสถานะที่เป๊ะเกินไป
        let result = await pool.request().query(`
            SELECT 
                c.case_id, c.case_priority, c.case_missing_reason, c.case_received_date, c.case_relation_to_missing,
                mp.missingperson_title, mp.missingperson_name, mp.missingperson_identity,
                p.people_name, p.people_phone,
                char_log.character_image_url, char_log.character_skin_color, char_log.character_body_shape, char_log.character_hair_style,
                seen_log.Last_Seen_date, seen_log.Last_Seen_time, seen_log.Last_Seen_place, seen_log.Last_Seen_subdistrict, seen_log.Last_Seen_district, seen_log.Last_Seen_province
            FROM MissingCase c
            LEFT JOIN MissingPerson mp ON c.missingperson_id = mp.missingperson_id
            LEFT JOIN People p ON c.people_id = p.people_id
            -- ใช้การ LEFT JOIN เข้าหา StatusLog โดยตรง (เดี๋ยวเราค่อยไปจัดการกรองเอาใน App หรือเปลี่ยนเป็น subquery ถ้าข้อมูลเยอะ)
            OUTER APPLY (
                SELECT TOP 1 * FROM StatusLog 
                WHERE StatusLog.case_id = c.case_id 
                ORDER BY log_id DESC
            ) slog
            LEFT JOIN Missingperson_Character_Log char_log ON slog.log_id = char_log.log_id
            LEFT JOIN Last_Seen_Log seen_log ON slog.log_id = seen_log.log_id
            ORDER BY c.case_received_date DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error("SQL Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
module.exports = router;
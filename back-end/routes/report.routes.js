const express = require('express');
const router = express.Router();
const sql = require('mssql');
const { dbConfig } = require('../config/db');

// POST /api/reports - บันทึกเบาะแส (จัดการ 3 ตาราง: Reporter, Reporter_Phone, ReportedTips)
router.post("/", async (req, res) => {
    //เพิ่มการตรวจสอบข้อมูลเบื้องต้น
    console.log("=== Received Report Data ===");
    console.log("Body:", req.body);
    // ป้องกันการพังถ้า req.body ว่างเปล่า
    const data = req.body || {};
    // ตรวจสอบชื่อตัวแปรเผื่อเพื่อนส่งมาหลายแบบ (case_id หรือ caseId หรือ m_id)
    const case_id = data.case_id || data.caseId || data.m_id;
    //ระบุเคส
    if (!case_id) {
        console.error("Missing case_id in request");
        return res.status(400).json({ 
            success: false, 
            error: "กรุณาระบุรหัสเคส (case_id)",
            debug_received_body: data 
        });
    }

    const pool = await sql.connect(dbConfig);
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // แกะค่าจาก data (ซึ่งคือ req.body)
const reporter_title =
    data.reporter_title || data.tipster_title;

const reporter_name =
    data.reporter_name || data.tipster_name;

const reporter_phone =
    data.reporter_phone || data.tipster_phone;

const details =
    data.details || data.tip_detail;

const location_found =
    data.location_found || data.tip_location;

        // 1. บันทึกข้อมูลผู้แจ้ง (Reporter)
        const reporterResult = await transaction.request()
            .input("title", sql.NVarChar, reporter_title || 'คุณ')
            .input("name", sql.NVarChar, reporter_name || 'ไม่ประสงค์ออกนาม')
            .query(`INSERT INTO Reporter (reporter_title, reporter_name) 
                    OUTPUT INSERTED.reporter_id VALUES (@title, @name)`);
        
        const reporter_id = reporterResult.recordset[0].reporter_id;

        // 2. บันทึกเบอร์โทรศัพท์ผู้แจ้ง (Reporter_Phone)
        if (reporter_phone) {
            await transaction.request()
                .input("rid", sql.Int, reporter_id)
                .input("phone", sql.NVarChar, reporter_phone)
                .query(`INSERT INTO Reporter_Phone (reporter_id, reporter_phone) VALUES (@rid, @phone)`);
        }

        // 3. สร้าง StatusLog (ปรับให้เก็บรายละเอียดเบาะแสได้ดีขึ้น)
        const logResult = await transaction.request()
            .input("case_id", sql.Int, case_id)
            .input("desc", sql.NVarChar, (details || 'แจ้งเบาะแสใหม่') + (location_found ? ` สถานที่: ${location_found}` : '')) 
            .input("status", sql.NVarChar, 'พบเบาะแสครั้งที่ 1')
            .input("by", sql.NVarChar, `ผู้แจ้งเบาะแส: ${reporter_name || 'Anonymous'}`)
            .query(`INSERT INTO StatusLog (case_id, description, case_status, logged_by) 
                    OUTPUT INSERTED.log_id 
                    VALUES (@case_id, @desc, @status, @by)`);
        
        const log_id = logResult.recordset[0].log_id;
        await transaction.request()
  .input("case_id", sql.Int, case_id)
  .query(`
    UPDATE MissingCase
    SET latest_status = N'พบเบาะแสครั้งที่ 1'
    WHERE case_id = @case_id
  `);

        // 4. บันทึกความสัมพันธ์การแจ้งเบาะแส (ReportedTips)
        await transaction.request()
            .input("rid", sql.Int, reporter_id)
            .input("cid", sql.Int, case_id)
            .input("lid", sql.Int, log_id)
            .query(`INSERT INTO ReportedTips (reporter_id, case_id, log_id) VALUES (@rid, @cid, @lid)`);

        await transaction.commit();
        res.status(201).json({ 
            success: true, 
            message: "บันทึกเบาะแสเรียบร้อยแล้ว",
            reporter_id,
            log_id 
        });

    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("SQL TRANSACTION ERROR:", err.message);
        res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดในการบันทึกข้อมูล SQL" });
    }
});

// GET /api/reports/:case_id
router.get("/:case_id", async (req, res) => {
    try {
        const { case_id } = req.params;
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input("id", sql.Int, case_id)
            .query(`
                SELECT 
                    rt.case_id,
                    r.reporter_name,
                    rp.reporter_phone,
                    sl.description as details,
                    sl.created_at as report_date
                FROM ReportedTips rt
                JOIN Reporter r ON rt.reporter_id = r.reporter_id
                LEFT JOIN Reporter_Phone rp ON r.reporter_id = rp.reporter_id
                JOIN StatusLog sl ON rt.log_id = sl.log_id
                WHERE rt.case_id = @id
                ORDER BY sl.created_at DESC
            `);

        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
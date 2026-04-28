const express = require('express');
const router = express.Router();
const sql = require('mssql');
const { dbConfig } = require('../config/db');

// POST /api/reports - บันทึกเบาะแส (จัดการ 3 ตาราง: Reporter, Reporter_Phone, ReportedTips)
router.post("/", async (req, res) => {
    const pool = await sql.connect(dbConfig);
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();
        const { 
            case_id, 
            reporter_name, 
            reporter_phone, 
            details, // จะบันทึกเป็น description ใน StatusLog
            location_found // ข้อมูลเพิ่มเติมสำหรับ Log
        } = req.body;

        // 1. บันทึกข้อมูลผู้แจ้ง (Reporter)
const reporterResult = await transaction.request()
            .input("title", sql.NVarChar, req.body.reporter_title || 'คุณ') // เพิ่มบรรทัดนี้
            .input("name", sql.NVarChar, reporter_name || 'ไม่ประสงค์ออกนาม')
            .query(`INSERT INTO Reporter (reporter_title, reporter_name) 
                    OUTPUT INSERTED.reporter_id VALUES (@title, @name)`); // แก้ Query ตรงนี้
        
        const reporter_id = reporterResult.recordset[0].reporter_id;

        // 2. บันทึกเบอร์โทรศัพท์ผู้แจ้ง (Reporter_Phone)
        if (reporter_phone) {
            await transaction.request()
                .input("rid", sql.Int, reporter_id)
                .input("phone", sql.NVarChar, reporter_phone)
                .query(`INSERT INTO Reporter_Phone (reporter_id, reporter_phone) VALUES (@rid, @phone)`);
        }

        // 3. สร้าง StatusLog สำหรับเบาะแสนี้ (เพื่อให้มี log_id ไปผูกกับ ReportedTips)
        const logResult = await transaction.request()
            .input("case_id", sql.Int, case_id)
            // ตรวจสอบให้แน่ใจว่าได้ส่งค่า details จาก req.body มาที่นี่
            .input("desc", sql.NVarChar, details || 'ได้รับแจ้งเบาะแสใหม่') 
            .input("status", sql.NVarChar, 'ได้รับเบาะแส')
            .input("by", sql.NVarChar, 'Reporter: ' + (reporter_name || 'Anonymous'))
            .query(`INSERT INTO StatusLog (case_id, description, case_status, logged_by) 
            OUTPUT INSERTED.log_id 
            VALUES (@case_id, @desc, @status, @by)`);
        
        const log_id = logResult.recordset[0].log_id;

        // 4. บันทึกความสัมพันธ์การแจ้งเบาะแส (ReportedTips)
        await transaction.request()
            .input("rid", sql.Int, reporter_id)
            .input("cid", sql.Int, case_id)
            .input("lid", sql.Int, log_id)
            .query(`INSERT INTO ReportedTips (reporter_id, case_id, log_id) VALUES (@rid, @cid, @lid)`);

        await transaction.commit();
        res.status(201).json({ 
            success: true, 
            message: "บันทึกเบาะแสและสร้างประวัติเรียบร้อยแล้ว",
            reporter_id,
            log_id 
        });

    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("REPORT ERROR:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports/:case_id - ดึงเบาะแสทั้งหมดของคดีนั้นๆ (Join ข้อมูลผู้แจ้ง)
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
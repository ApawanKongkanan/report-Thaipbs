const express = require('express');
const router = express.Router();
const sql = require('mssql');
const { dbConfig } = require('../config/db');

router.get("/", async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // ดึงสถิติตัวเลขจาก View (เขียนง่ายขึ้นมาก)
        const stats = await pool.request().query(`
            SELECT 
                COUNT(*) as total_cases,
                SUM(total_tips_received) as total_tips,
                COUNT(CASE WHEN latest_status = N'พบตัวแล้ว' THEN 1 END) as found_cases
            FROM vw_MissingPerson_Dashboard
        `);

        // ดึงรายการล่าสุด 5 เคสจาก View
        const recentCases = await pool.request().query(`
            SELECT TOP 5 
                case_id, missing_name, latest_status, received_date, province 
            FROM vw_MissingPerson_Dashboard 
            ORDER BY received_date DESC
        `);

        res.json({ 
            success: true, 
            summary: stats.recordset[0],
            recent_cases: recentCases.recordset 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
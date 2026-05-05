const express = require("express");
const router = express.Router();
// ดึงค่าตามที่เขียนไว้ใน config/db.js
const { sql, dbConfig } = require("../config/db");

router.get("/stats", async (req, res) => {
    try {
        // ใช้ dbConfig ที่ดึงมาจากไฟล์ config
        const pool = await sql.connect(dbConfig); 
        
        const statusStats = await pool.request().query(`
            SELECT latest_status as status, COUNT(*) as count 
            FROM MissingCase 
            GROUP BY latest_status
        `);

        const priorityStats = await pool.request().query(`
            SELECT priority, COUNT(*) as count 
            FROM MissingCase 
            GROUP BY priority
        `);

        res.json({
            success: true,
            data: {
                statusOverview: statusStats.recordset,
                priorityOverview: priorityStats.recordset,
                totalCases: statusStats.recordset.reduce((acc, curr) => acc + curr.count, 0)
            }
        });
    } catch (err) {
        console.error("Dashboard Stats Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
const express = require("express");
const router = express.Router();
// ดึงค่าตามที่เขียนไว้ใน config/db.js
const { sql, dbConfig } = require("../config/db");

router.get("/stats", async (req, res) => {
    try {
        // ใช้ dbConfig ที่ดึงมาจากไฟล์ config
        const pool = await sql.connect(dbConfig); 
        
        const statusStats = await pool.request().query(`
    SELECT
      latest_status as status,
      COUNT(*) as count

    FROM MissingCase

    WHERE latest_status != N'ยกเลิกเคส'

    GROUP BY latest_status
`);

        const priorityStats = await pool.request().query(`
    SELECT
      priority,
      COUNT(*) as count

    FROM MissingCase

    WHERE latest_status != N'ยกเลิกเคส'

    GROUP BY priority
`);

        const monthlyStats = await pool.request().query(`
    SELECT 
      MONTH(received_date) as month,
      COUNT(*) as count

    FROM MissingCase

    WHERE latest_status != N'ยกเลิกเคส'

    GROUP BY MONTH(received_date)

    ORDER BY month
`);
        const provinceStats = await pool.request().query(`
    SELECT

      ISNULL(
        JSON_VALUE(latest_last_seen_at, '$.province'),
        N'ไม่ระบุ'
      ) as province,

      COUNT(*) as count

    FROM MissingCase

    WHERE latest_status != N'ยกเลิกเคส'

    GROUP BY JSON_VALUE(latest_last_seen_at, '$.province')

    ORDER BY count DESC
`);

        const avgAge = await pool.request().query(`
  SELECT AVG(CAST(age as float)) as avg_age
  FROM MissingPerson
`);

const tipStats = await pool.request().query(`
  SELECT COUNT(*) as total_tips
  FROM ReportedTips
`);

const latestCases = await pool.request().query(`
  SELECT TOP 5

    mc.case_id,
    mp.missing_name,
    mc.latest_status,
    mc.priority,
    mc.received_date

  FROM MissingCase mc

  JOIN MissingPerson mp
    ON mc.missingperson_id = mp.missingperson_id

  WHERE mc.latest_status != N'ยกเลิกเคส'

  ORDER BY mc.received_date DESC
`);

       res.json({
  success: true,
  data: {

    totalCases:
      statusStats.recordset.reduce(
        (acc, curr) => acc + curr.count,
        0
      ),

    statusOverview:
      statusStats.recordset,

    priorityOverview:
      priorityStats.recordset,

    monthlyOverview:
      monthlyStats.recordset,

    provinceOverview:
      provinceStats.recordset,

    averageAge:
      avgAge.recordset[0].avg_age || 0,

    totalTips:
      tipStats.recordset[0].total_tips || 0,

    latestCases:
      latestCases.recordset
  }
});
    } catch (err) {
        console.error("Dashboard Stats Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
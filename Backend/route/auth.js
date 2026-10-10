const express = require("express");
const router = express.Router();
const { sql, dbConfig } = require("../config/db");
// const bcrypt = require("bcrypt"); 

// --- 1. สมัครสมาชิก  ---
router.post("/register", async (req, res) => {
    try {
        const { people_id, people_title, people_name, account, password } = req.body;
        const plainPassword = password.toString();

        const pool = await sql.connect(dbConfig);
        
        await pool.request()
            .input("id", sql.Int, people_id)
            .input("title", sql.NVarChar, people_title)
            .input("name", sql.NVarChar, people_name)
            .input("account", sql.NVarChar, account)
            .input("pass", sql.NVarChar, plainPassword) 
            .query(`
                INSERT INTO People (people_id, people_title, people_name, people_account, people_password_hash, people_created_at)
                VALUES (@id, @title, @name, @account, @pass, GETDATE())
            `);

        res.status(201).json({ success: true, message: "ลงทะเบียนสำเร็จ" });
    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 2. เข้าสู่ระบบ  ---
router.post("/login", async (req, res) => {
    try {
        const { username, password, role } = req.body;
        const pool = await sql.connect(dbConfig);
        
        let user = null;
        let queryResult = null;

        if (role === "admin") {
            queryResult = await pool.request()
                .input("user", sql.NVarChar, username.trim())
                .query(`SELECT staff_id as id, staff_name as name, staff_password_hash as password, 'admin' as role FROM Staff WHERE RTRIM(staff_account) = @user`);
        } 
        else if (role === "relative") {
            // ค้นหาโดยใช้เบอร์โทรศัพท์
            const queryResult = await pool.request()
                .input("phone", sql.NVarChar, username.trim())
                .query(`SELECT people_id as id, people_name as name, people_phone, people_password_hash as password, 'relative' as role 
                        FROM People WHERE people_phone = @phone OR people_account = @phone`);

            if (queryResult.recordset.length > 0) {
                const user = queryResult.recordset[0];
            
                const last4Phone = user.people_phone.slice(-4); 

                if (password.trim() === user.password || password.trim() === last4Phone) {
                    return res.json({ 
                        success: true, 
                        user: { user_id: user.id, name: user.name, role: user.role } 
                    });
                } else {
                    return res.status(401).json({ success: false, message: "รหัสผ่านไม่ถูกต้อง (ลองใช้เลข 4 ตัวท้ายของเบอร์โทร)" });
                }
            }
            
            return res.status(401).json({ success: false, message: "ไม่พบข้อมูลบัญชีผู้ใช้งานนี้" });
        }

        if (queryResult && queryResult.recordset.length > 0) {
            user = queryResult.recordset[0];
            
            // 🌟 4. เปรียบเทียบรหัสผ่านแบบธรรมดา (Plain Text) สำหรับโปรเจกต์ทดสอบ
            const isMatch = (password.toString() === user.password.toString());

            if (isMatch) {
                return res.json({ success: true, user: { user_id: user.id, name: user.name, role: user.role } });
            }
        }

        return res.status(401).json({ success: false, message: "ชื่อผู้ใช้งาน หรือ รหัสผ่านไม่ถูกต้อง" });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
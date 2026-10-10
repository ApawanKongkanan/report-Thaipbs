const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { sql, dbConfig } = require("../config/db");

// ==========================================================
// 🔐 กติกาความปลอดภัยขั้นพื้นฐาน (ต้องตรงกับหน้า register.html)
// ==========================================================
const BCRYPT_ROUNDS = 10;

// ชื่อผู้ใช้: 4-20 ตัว ใช้ได้เฉพาะ a-z, 0-9, จุด และขีดล่าง
// และต้องมีตัวอักษรอย่างน้อย 1 ตัว (กันไม่ให้ตั้งชื่อเป็นเบอร์โทรศัพท์ของคนอื่น)
const USERNAME_RULE = /^(?=.*[a-z])[a-z0-9._]{4,20}$/;

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 64; // bcrypt อ่านได้สูงสุด 72 ไบต์ จึงจำกัดความยาวไว้

function checkPassword(pw) {
    const errors = [];
    if (pw.length < PASSWORD_MIN) errors.push("ต้องมีความยาวอย่างน้อย 8 ตัวอักษร");
    if (pw.length > PASSWORD_MAX || Buffer.byteLength(pw, "utf8") > 72) errors.push("ยาวเกินไป (ไม่เกิน 64 ตัวอักษร)");
    if (!/[a-z]/.test(pw)) errors.push("ต้องมีตัวพิมพ์เล็ก (a-z) อย่างน้อย 1 ตัว");
    if (!/[A-Z]/.test(pw)) errors.push("ต้องมีตัวพิมพ์ใหญ่ (A-Z) อย่างน้อย 1 ตัว");
    if (!/[0-9]/.test(pw)) errors.push("ต้องมีตัวเลข (0-9) อย่างน้อย 1 ตัว");
    if (/\s/.test(pw)) errors.push("ห้ามมีช่องว่าง");
    return errors;
}

// ==========================================================
// 🛡️ จำกัดจำนวนครั้งต่อ IP (กันการเดารหัสผ่าน/สมัครรัวๆ) — เก็บในหน่วยความจำ
// ==========================================================
function rateLimit({ windowMs, max, message }) {
    const hits = new Map(); // ip -> { count, resetAt }
    const sweeper = setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
    }, windowMs);
    sweeper.unref();

    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || "unknown";
        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }
        entry.count++;
        if (entry.count > max) {
            res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).json({ success: false, message });
        }
        next();
    };
}

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "มีการลงทะเบียนจากเครื่องนี้บ่อยเกินไป กรุณาลองใหม่ในอีก 15 นาที",
});
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ในอีก 15 นาที",
});

// --- 1. ลงทะเบียนบัญชีญาติผู้สูญหาย (ใช้แค่ username + password) ---
router.post("/register", registerLimiter, async (req, res) => {
    const { username, password } = req.body || {};

    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
        return res.status(400).json({ success: false, message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน" });
    }

    const account = username.trim().toLowerCase();
    if (!USERNAME_RULE.test(account)) {
        return res.status(400).json({
            success: false,
            message: "ชื่อผู้ใช้ต้องยาว 4-20 ตัว ใช้ได้เฉพาะ a-z, 0-9, จุด (.) และขีดล่าง (_) และต้องมีตัวอักษรอย่างน้อย 1 ตัว",
        });
    }

    const pwErrors = checkPassword(password);
    if (pwErrors.length > 0) {
        return res.status(400).json({ success: false, message: "รหัสผ่าน" + pwErrors.join(", "), errors: pwErrors });
    }

    try {
        const pool = await sql.connect(dbConfig);

        // ห้ามชื่อผู้ใช้ซ้ำ (เช็คทั้งชื่อบัญชีและเบอร์โทรของบัญชีเดิม)
        const exists = await pool.request()
            .input("account", sql.NVarChar, account)
            .query(`SELECT TOP 1 1 AS found FROM People
                    WHERE LOWER(people_account) = @account OR people_phone = @account`);
        if (exists.recordset.length > 0) {
            return res.status(409).json({ success: false, message: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น" });
        }

        // เก็บเฉพาะค่า hash ไม่เก็บรหัสผ่านจริงลงฐานข้อมูล
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // สุ่ม people_id ฝั่งเซิร์ฟเวอร์ (แบบเดียวกับตอนสร้างเคส) ถ้าชนกับของเดิมให้สุ่มใหม่
        for (let attempt = 0; attempt < 5; attempt++) {
            const peopleId = Math.floor(100000 + Math.random() * 900000);
            try {
                await pool.request()
                    .input("id", sql.Int, peopleId)
                    .input("title", sql.NVarChar, "")
                    .input("name", sql.NVarChar, account)
                    .input("account", sql.NVarChar, account)
                    .input("hash", sql.NVarChar, passwordHash)
                    .query(`
                        INSERT INTO People (people_id, people_title, people_name, people_account, people_password_hash, people_created_at)
                        VALUES (@id, @title, @name, @account, @hash, GETDATE())
                    `);
                return res.status(201).json({ success: true, message: "ลงทะเบียนสำเร็จ" });
            } catch (err) {
                if (err.number === 2627 || err.number === 2601) continue; // id ซ้ำ ลองใหม่
                throw err;
            }
        }
        throw new Error("Could not allocate a unique people_id");
    } catch (err) {
        console.error("Register Error:", err);
        // ไม่ส่งรายละเอียด error ของระบบกลับไปให้ผู้ใช้เห็น
        return res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" });
    }
});

// ตรวจรหัสผ่านของญาติ
async function verifyRelativePassword(input, user) {
    const stored = user.password ? String(user.password) : "";

    // บัญชีที่สมัครผ่านหน้า register.html (เก็บเป็น bcrypt hash)
    if (stored.startsWith("$2")) return bcrypt.compare(input, stored);

    // บัญชีเดิมที่เจ้าหน้าที่สร้างให้ตอนเพิ่มเคส (ยังเก็บแบบข้อความธรรมดา) — คงไว้เพื่อไม่ให้ระบบเดิมใช้งานไม่ได้
    const typed = input.trim();
    if (stored && typed === stored.trim()) return true;
    const phone = user.people_phone ? String(user.people_phone) : "";
    if (phone.length >= 4 && typed === phone.slice(-4)) return true;
    return false;
}

// --- 2. เข้าสู่ระบบ  ---
router.post("/login", loginLimiter, async (req, res) => {
    try {
        const { username, password, role } = req.body || {};
        if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
            return res.status(400).json({ success: false, message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
        }

        const pool = await sql.connect(dbConfig);

        let user = null;
        let queryResult = null;

        if (role === "admin") {
            queryResult = await pool.request()
                .input("user", sql.NVarChar, username.trim())
                .query(`SELECT staff_id as id, staff_name as name, staff_password_hash as password, 'admin' as role FROM Staff WHERE RTRIM(staff_account) = @user`);
        }
        else if (role === "relative") {
            // ค้นหาได้ทั้งชื่อผู้ใช้ (บัญชีที่สมัครเอง) และเบอร์โทรศัพท์ (บัญชีที่เจ้าหน้าที่สร้างให้)
            const relativeResult = await pool.request()
                .input("loginId", sql.NVarChar, username.trim())
                .query(`SELECT people_id as id, people_name as name, people_phone, people_password_hash as password, 'relative' as role
                        FROM People WHERE people_phone = @loginId OR LOWER(people_account) = LOWER(@loginId)`);

            const relative = relativeResult.recordset[0];
            if (relative && await verifyRelativePassword(password, relative)) {
                return res.json({
                    success: true,
                    user: { user_id: relative.id, name: relative.name, role: relative.role }
                });
            }
            // ใช้ข้อความเดียวกันทุกกรณี เพื่อไม่ให้รู้ว่าชื่อผู้ใช้นี้มีอยู่ในระบบหรือไม่
            return res.status(401).json({ success: false, message: "ชื่อผู้ใช้งาน หรือ รหัสผ่านไม่ถูกต้อง" });
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
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" });
    }
});

module.exports = router;

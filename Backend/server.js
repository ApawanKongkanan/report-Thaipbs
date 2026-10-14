const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

// 1. นำเข้า Routes จากทั้ง 2 ไฟล์
const missingRoutes = require('./route/missing.route');
const authRoutes = require('./route/auth'); 

const app = express();

if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is missing in .env');
}

app.use(cors());
app.use(express.json());

app.use(session({
    name: 'thaipbs.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000
    }
}));

// เปิดให้หน้าบ้านเข้าถึงไฟล์รูปภาพ
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 2. ใช้งาน Routes
app.use('/api', missingRoutes);
app.use('/api', authRoutes); 

// ==========================================
// 3. ตั้งค่าเสิร์ฟไฟล์หน้าเว็บ (Frontend)
// ==========================================
// เนื่องจาก server.js อยู่ใน Backend ต้องย้อนไป 1 โฟลเดอร์ ('../') เพื่อเข้า Frontend
const frontendPath = path.join(__dirname, '../Frontend');
app.use(express.static(frontendPath));

// เข้าหน้าแรกให้เจอ Login
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'login.html'));
});

// เพิ่ม Route สำหรับหน้า Homepage
app.get('/home', (req, res) => {
    res.sendFile(path.join(frontendPath, 'Homepage.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
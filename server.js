const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'vip-lotto-secret-key';

// เชื่อมต่อ Supabase โดยดึงค่าจาก Environment Variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors());
app.use(express.json());

// 1. API Login (ตรวจสอบข้อมูลผู้ใช้จากตาราง users ใน Supabase)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    // แอดมินหลัก
    if (username === 'admin' && password === '123456') {
        const token = jwt.sign({ username, role: 'admin' }, SECRET_KEY, { expiresIn: '1h' });
        return res.json({ success: true, token, role: 'admin' });
    }
    
    // ตรวจสอบจากฐานข้อมูล Supabase
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();

    if (error || !data) {
        return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const token = jwt.sign({ username: data.username, role: data.role }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ success: true, token, role: data.role });
});

// 2. API ดึงประเภทหวยและอัตราจ่าย (จากตาราง lotto_types ใน Supabase)
app.get('/api/lotto-types', async (req, res) => {
    const { data, error } = await supabase.from('lotto_types').select('*');
    
    if (error || !data || data.length === 0) {
        // Fallback ข้อมูลสำรองกรณีที่ยังไม่ได้สร้างตารางใน Supabase
        return res.json([
            { id: 1, name: 'หวยรัฐบาลไทย', rate: 900 },
            { id: 2, name: 'หวยลาว', rate: 850 },
            { id: 3, name: 'หวยฮานอย', rate: 850 },
            { id: 4, name: 'หวยหุ้นนิเคอิ', rate: 750 }
        ]);
    }
    
    res.json(data);
});

// 3. API บันทึกโพยหวยลงตาราง bets ใน Supabase
app.post('/api/bets', async (req, res) => {
    const { username, lotto_type, number, amount } = req.body;
    
    const { data, error } = await supabase
        .from('bets')
        .insert([{ username: username || 'guest', lotto_type, number, amount }]);

    if (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
    
    res.json({ success: true, message: 'ส่งโพยสำเร็จ', data });
});

// --- ตั้งค่าเสิร์ฟหน้าเว็บ (Static Files) ---
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// เริ่มรันเซิร์ฟเวอร์
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
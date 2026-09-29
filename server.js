const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'VIP_LOTTO_SUPER_SECRET_KEY'; // แนะนำให้เปลี่ยนหรือย้ายไปใส่ .env

// ตั้งค่าการเชื่อมต่อฐานข้อมูล PostgreSQL
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'vip_lotto',
    password: 'your_password', // เปลี่ยนเป็นรหัสผ่านฐานข้อมูลของคุณ
    port: 5432,
});

app.use(cors());
app.use(express.json());

// Middleware สำหรับตรวจสอบ Token ยืนยันตัวตน
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized: ไม่พบ Token ยืนยันตัวตน' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Forbidden: Token ไม่ถูกต้องหรือหมดอายุ' });
        }
        req.user = user;
        next();
    });
}

// ==========================================
// 1. ระบบผู้ใช้งาน (Authentication)
// ==========================================

// เข้าสู่ระบบ (Login)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            JWT_SECRET, 
            { expiresIn: '1d' }
        );
        
        res.json({ success: true, token, role: user.role, username: user.username });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
    }
});


// ==========================================
// 2. ระบบแทงหวย (Betting Terminal)
// ==========================================

// ส่งโพยหวย
app.post('/api/submit-bet', authenticateToken, async (req, res) => {
    const { bets, totalAmount } = req.body;
    const userId = req.user.id;

    if (!bets || bets.length === 0 || !totalAmount) {
        return res.status(400).json({ success: false, message: 'ข้อมูลโพยไม่ถูกต้อง' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ตรวจสอบยอดเครดิตของผู้ใช้
        const userRes = await client.query('SELECT credit FROM users WHERE id = $1', [userId]);
        const currentCredit = parseFloat(userRes.rows[0].credit);

        if (currentCredit < totalAmount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'เครดิตของคุณไม่เพียงพอสำหรับการแทง' });
        }

        // หักเครดิตออกจากกระเป๋าผู้ใช้
        await client.query('UPDATE users SET credit = credit - $1 WHERE id = $2', [totalAmount, userId]);

        // บันทึกข้อมูลโพยหลักลงตาราง bets
        const ticketRes = await client.query(
            'INSERT INTO bets (user_id, total_amount, status) VALUES ($1, $2, $3) RETURNING id',
            [userId, totalAmount, 'pending']
        );
        const ticketId = ticketRes.rows[0].id;

        await client.query('COMMIT');
        res.json({ success: true, message: 'ส่งโพยสำเร็จ', ticketId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Submit bet error:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกโพย' });
    } finally {
        client.release();
    }
});


// ==========================================
// 3. ระบบแอดมินและจัดการหลังบ้าน (Admin API)
// ==========================================

// ดึงรายการโพยทั้งหมดสำหรับหน้าแอดมิน
app.get('/api/admin/tickets', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.id, u.username, b.total_amount, b.status, b.created_at 
            FROM bets b 
            JOIN users u ON b.user_id = u.id 
            ORDER BY b.id DESC
        `);
        res.json({ success: true, tickets: result.rows });
    } catch (err) {
        console.error('Error fetching admin tickets:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลโพย' });
    }
});

// ดึงรายชื่อสมาชิกทั้งหมดสำหรับหน้าจัดการสมาชิก[cite: 17]
app.get('/api/admin/members', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, credit, status, created_at FROM users ORDER BY id DESC'
        );
        res.json({ success: true, members: result.rows });
    } catch (err) {
        console.error('Error fetching members:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสมาชิก' });
    }
});

// ปรับปรุงเครดิตสมาชิก (เติม/หักเครดิต)[cite: 17]
app.post('/api/admin/members/credit', authenticateToken, async (req, res) => {
    const { userId, amount, type } = req.body; // type: 'add' หรือ 'sub'
    
    if (!userId || !amount || !['add', 'sub'].includes(type)) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วนหรือไม่ถูกต้อง' });
    }

    try {
        const userCheck = await pool.query('SELECT credit FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
        }

        let currentCredit = parseFloat(userCheck.rows[0].credit);
        let changeAmount = parseFloat(amount);
        let newCredit = type === 'add' ? currentCredit + changeAmount : currentCredit - changeAmount;

        if (newCredit < 0) {
            return res.status(400).json({ success: false, message: 'เครดิตไม่เพียงพอที่จะหักออก' });
        }

        await pool.query('UPDATE users SET credit = $1 WHERE id = $2', [newCredit, userId]);
        
        res.json({ 
            success: true, 
            message: 'อัปเดตเครดิตสำเร็จ', 
            userId: userId,
            newCredit: newCredit 
        });
    } catch (err) {
        console.error('Error updating credit:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการปรับปรุงเครดิต' });
    }
});

// หน้ารายงานสรุปยอดรวมและยอดแทงย้อนหลัง[cite: 20]
app.get('/api/admin/reports', authenticateToken, async (req, res) => {
    try {
        const summaryQuery = await pool.query(`
            SELECT 
                COUNT(*) as total_tickets,
                COALESCE(SUM(total_amount), 0) as total_turnover
            FROM bets
        `);

        const dailyQuery = await pool.query(`
            SELECT 
                TO_CHAR(created_at, 'YYYY-MM-DD') as bet_date,
                COUNT(*) as ticket_count,
                COALESCE(SUM(total_amount), 0) as daily_amount
            FROM bets
            GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
            ORDER BY bet_date DESC
            LIMIT 7
        `);

        res.json({
            success: true,
            summary: summaryQuery.rows[0],
            dailyReports: dailyQuery.rows
        });
    } catch (err) {
        console.error('Error fetching reports:', err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน' });
    }
});

// เริ่มต้นรันเซิร์ฟเวอร์
app.listen(PORT, () => {
    console.log(`🚀 Server is running smoothly on port ${PORT}`);
});
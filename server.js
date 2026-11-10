// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const pool = require('./db');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const lguRoutes = require('./routes/lgu');
const partnershipsRoutes = require('./routes/partnerships');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'collabnet_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 }
}));

// Session Normalization Middleware
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    req.session.user_id = req.session.user.user_id;
    req.session.full_name = req.session.user.full_name;
    req.session.role = req.session.user.role;
    req.session.email = req.session.user.email;
  }
  next();
});

app.use(express.static('assets'));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/lgu', lguRoutes);
app.use('/api/partnerships', partnershipsRoutes);

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'OK', dbTime: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/verify-certificate/:cert_no', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'verify-certificate.html'));
});
// GET: Public Certificate Verification Endpoint
app.get('/api/public/verify-certificate/:cert_no', async (req, res) => {
    const { cert_no } = req.params;

    try {
        const query = `
            SELECT 
                p.participant_id,
                p.certificate_no,
                p.hours_rendered,
                p.verified_at,
                p.certificate_issued,
                u.full_name AS student_name,
                u.course,
                u.student_id,
                a.title AS activity_title,
                a.location,
                a.target_date,
                a.estimated_hours,
                d.dept_name
            FROM activity_participants p
            JOIN users u ON p.user_id = u.user_id
            JOIN programs_activities a ON p.activity_id = a.activity_id
            LEFT JOIN lgu_departments d ON a.dept_id = d.dept_id
            WHERE p.certificate_no = $1 OR p.participant_id::text = $1
        `;
        
        const result = await db.query(query, [cert_no]);

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                valid: false, 
                message: 'Invalid Certificate Number. No record found in CollabNet database.' 
            });
        }

        const record = result.rows[0];

        return res.json({
            success: true,
            valid: true,
            certificate: {
                certNo: record.certificate_no || `CERT-2026-${record.participant_id}`,
                studentName: record.student_name,
                course: record.course,
                studentId: record.student_id,
                activityTitle: record.activity_title,
                department: record.dept_name || 'LGU Vinzons',
                location: record.location || 'Vinzons, Camarines Norte',
                targetDate: record.target_date ? new Date(record.target_date).toISOString().split('T')[0] : 'N/A',
                hoursRendered: parseFloat(record.hours_rendered || record.estimated_hours || 0),
                issuedAt: record.verified_at ? new Date(record.verified_at).toLocaleDateString() : 'Official Issue'
            }
        });

    } catch (err) {
        console.error('QR Verification Error:', err);
        return res.status(500).json({ success: false, message: 'Server error verifying certificate.' });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CollabNet server running on http://localhost:${PORT}`));

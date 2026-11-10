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

    if (!cert_no) {
        return res.status(400).json({ success: false, valid: false, message: 'Certificate reference number is required.' });
    }

    try {
        // Extract raw numeric participant_id from format like 'CERT-2026-00070' or '70'
        const numericMatch = cert_no.match(/\d+$/);
        const extractedId = numericMatch ? parseInt(numericMatch[0], 10) : NaN;

        // Query participant details cleanly without forcing invalid type comparisons
        const query = `
            SELECT 
                p.participant_id,
                p.hours_rendered,
                p.target_reached,
                p.early_out_reason,
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
            WHERE p.participant_id = $1 OR p.participant_id::text = $2
        `;

        // Pass valid integer or fallback to 0 if NaN to avoid PostgreSQL 22P02 error
        const paramId = isNaN(extractedId) ? 0 : extractedId;
        const result = await db.query(query, [paramId, cert_no]);

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                valid: false, 
                message: 'Invalid Certificate Number. No matching record found in CollabNet database.' 
            });
        }

        const record = result.rows[0];

        // Verify hours and completion status
        const rendered = parseFloat(record.hours_rendered || 0);
        const target = parseFloat(record.estimated_hours || 0);
        const isCompleted = record.target_reached || rendered >= target;

        if (!isCompleted && record.early_out_reason) {
            return res.status(400).json({
                success: false,
                valid: false,
                message: 'Certificate is invalid: Student timed out early and is marked ineligible.'
            });
        }

        const formattedCertNo = `CERT-2026-${record.participant_id.toString().padStart(5, '0')}`;

        return res.json({
            success: true,
            valid: true,
            certificate: {
                certNo: formattedCertNo,
                studentName: record.student_name,
                course: record.course,
                studentId: record.student_id,
                activityTitle: record.activity_title,
                department: record.dept_name || 'LGU Vinzons',
                location: record.location || 'Vinzons, Camarines Norte',
                targetDate: record.target_date ? new Date(record.target_date).toISOString().split('T')[0] : 'N/A',
                hoursRendered: parseFloat(record.hours_rendered || record.estimated_hours || 0)
            }
        });

    } catch (err) {
        console.error('QR Verification Server Error:', err);
        return res.status(500).json({ 
            success: false, 
            valid: false, 
            message: 'Server error verifying certificate. Please check server logs.',
            error: err.message 
        });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CollabNet server running on http://localhost:${PORT}`));

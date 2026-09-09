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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CollabNet server running on http://localhost:${PORT}`));

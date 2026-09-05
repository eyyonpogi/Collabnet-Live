const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs'); // Or require('bcrypt')
const pool = require('../db');

// --- LOGIN ENDPOINT ---
// --- LOGIN ENDPOINT ---
// --- LOGIN ENDPOINT ---
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email/Student ID and password are required.' });
  }

  const cleanInput = email.trim().toLowerCase();

  try {
    const query = `
      SELECT user_id, full_name, email, role, is_verified, password
      FROM users 
      WHERE LOWER(email) = $1 OR LOWER(student_id) = $1
    `;
    const { rows } = await pool.query(query, [cleanInput]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid Email/Student ID or password.' });
    }

    const user = rows[0];

    if (!user.password) {
      return res.status(400).json({ error: 'Account setup incomplete. Missing password.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid Email/Student ID or password.' });
    }

    if (user.role === 'Student' && (user.is_verified === false || user.is_verified === 'false')) {
      return res.status(403).json({ 
        error: 'Your account is pending official enrollment verification by the Extension Office.' 
      });
    }

    // Set nested object AND flat properties for full route compatibility
    req.session.user = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      role: user.role
    };

    req.session.user_id = user.user_id;
    req.session.full_name = user.full_name;
    req.session.email = user.email;
    req.session.role = user.role;

    // Persist session to cookie before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Failed to initialize user session.' });
      }

      let redirectUrl = '/student_dashboard.html';
      if (user.role === 'Admin' || user.role === 'Extension Director') {
        redirectUrl = '/admin_dashboard.html';
      } else if (user.role === 'Agency Admin' || user.role === 'LGU Coordinator') {
        redirectUrl = '/lgu_dashboard.html';
      }

      return res.json({
        success: true,
        message: 'Login successful!',
        user: req.session.user,
        redirectUrl
      });
    });

  } catch (err) {
    console.error('Login Server Error:', err);
    return res.status(500).json({ error: `Server Error: ${err.message}` });
  }
});

// --- REGISTER ENDPOINT ---
router.post('/register', async (req, res) => {
  const { full_name, email, password, role, student_id, course, agency_id } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Full Name, Email, and Password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = full_name.trim();
  const userRole = role || 'Student';

  try {
    const emailCheck = await pool.query('SELECT user_id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    if (userRole === 'Student' && student_id) {
      const studentIdCheck = await pool.query('SELECT user_id FROM users WHERE LOWER(student_id) = $1', [student_id.trim().toLowerCase()]);
      if (studentIdCheck.rows.length > 0) {
        return res.status(400).json({ error: 'This Student ID is already registered.' });
      }
    }

    const saltRounds = 10;
    // Renamed hashed variable to 'hashedPassword' to prevent JavaScript scope collision with req.body.password
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const is_verified = userRole === 'Student' ? false : true;

    const insertQuery = `
      INSERT INTO users (full_name, email, password, role, student_id, course, agency_id, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING user_id, full_name, email, role, is_verified
    `;

    const values = [
      cleanName,
      cleanEmail,
      hashedPassword,
      userRole,
      student_id ? student_id.trim() : null,
      course ? course.trim() : null,
      agency_id ? parseInt(agency_id) : null,
      is_verified
    ];

    const { rows } = await pool.query(insertQuery, values);
    const newUser = rows[0];

    req.session.user = {
      user_id: newUser.user_id,
      full_name: newUser.full_name,
      email: newUser.email,
      role: newUser.role
    };

    res.status(201).json({
      success: true,
      message: userRole === 'Student' 
        ? 'Account created! Registration is pending official enrollment verification.' 
        : 'Account created successfully!',
      user: newUser
    });

  } catch (err) {
    console.error('Account Creation Error:', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email or Student ID already exists in the system.' });
    }
    res.status(500).json({ error: `Registration DB Error: ${err.message}` });
  }
});

// --- LOGOUT ENDPOINT ---
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Failed to logout.' });
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out successfully!' });
  });
});

module.exports = router;
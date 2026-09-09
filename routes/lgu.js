const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Security Guard: Restrict exclusively to LGU Vinzons / Agency Admins
router.use(requireAuth, requireRole('Agency Admin'));

// --- 1. LGU DASHBOARD (Executive Summary) ---
router.get('/dashboard', async (req, res) => {
  const selectedActId = parseInt(req.query.act_id, 10) || 0;

  try {
    const deptCountRes = await pool.query('SELECT COUNT(*) AS total FROM lgu_departments');
    const pendingRes = await pool.query("SELECT COUNT(*) AS total FROM programs_activities WHERE status = 'Pending'");
    const approvedRes = await pool.query("SELECT COUNT(*) AS total FROM programs_activities WHERE status = 'Approved'");
    const volunteersRes = await pool.query(
      "SELECT COUNT(*) AS total FROM activity_participants WHERE status IN ('Joined', 'Completed')"
    );

    // Fetch top 5 recent approved activities for quick dashboard viewing
    const approvedActivitiesQuery = `
      SELECT p.*, d.dept_name,
             (SELECT COUNT(*) FROM activity_participants ap WHERE ap.activity_id = p.activity_id) AS total_joined
      FROM programs_activities p
      LEFT JOIN lgu_departments d ON p.dept_id = d.dept_id
      WHERE p.status = 'Approved'
      ORDER BY p.target_date DESC LIMIT 5
    `;
    const approvedActivities = await pool.query(approvedActivitiesQuery);

    let studentLogs = [];
    if (selectedActId > 0) {
      const logsQuery = `
        SELECT u.full_name, u.student_id, u.email,
               COALESCE(ap.time_in, ap.time_in_at) AS formatted_time_in,
               COALESCE(ap.time_out, ap.time_out_at) AS formatted_time_out,
               ap.hours_rendered, ap.target_reached, ap.status AS volunteer_status,
               pa.estimated_hours AS target_hours
        FROM activity_participants ap
        JOIN users u ON ap.user_id = u.user_id
        JOIN programs_activities pa ON ap.activity_id = pa.activity_id
        WHERE ap.activity_id = $1
        ORDER BY u.full_name ASC
      `;
      const logsRes = await pool.query(logsQuery, [selectedActId]);
      studentLogs = logsRes.rows;
    }

    res.json({
      success: true,
      stats: {
        totalDepartments: parseInt(deptCountRes.rows[0].total, 10),
        totalPendingProposals: parseInt(pendingRes.rows[0].total, 10),
        totalApprovedActivities: parseInt(approvedRes.rows[0].total, 10),
        totalVolunteers: parseInt(volunteersRes.rows[0].total, 10)
      },
      approvedActivities: approvedActivities.rows,
      inspectedLogs: studentLogs
    });
  } catch (err) {
    console.error('LGU Dashboard Error:', err);
    res.status(500).json({ error: 'Failed to load LGU operational dashboard.' });
  }
});

// --- 2. FETCH ALL EXTENSION ACTIVITIES (Full Page) ---
router.get('/activities', async (req, res) => {
  const { status } = req.query;
  try {
    let query = `
      SELECT p.*, d.dept_name,
             (SELECT COUNT(*) FROM activity_participants ap WHERE ap.activity_id = p.activity_id) AS total_joined
      FROM programs_activities p
      LEFT JOIN lgu_departments d ON p.dept_id = d.dept_id
    `;
    let params = [];

    if (status && status !== 'All') {
      query += ' WHERE p.status = $1';
      params.push(status);
    }

    query += ' ORDER BY p.target_date DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, activities: rows });
  } catch (err) {
    console.error('Fetch LGU Activities Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- 2. FETCH EXTENSION ACTIVITIES ---
router.get('/activities', async (req, res) => {
  const { status } = req.query;
  try {
    let query = `
      SELECT p.*, d.dept_name 
      FROM programs_activities p
      LEFT JOIN lgu_departments d ON p.dept_id = d.dept_id
    `;
    let params = [];

    if (status && status !== 'All') {
      query += ' WHERE p.status = $1';
      params.push(status);
    }

    query += ' ORDER BY p.target_date DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, activities: rows });
  } catch (err) {
    console.error('Fetch LGU Activities Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper function: Submit proposed community extension activity with validity lifespan
const handleProposeActivity = async (req, res) => {
  const title           = req.body.title ? req.body.title.trim() : '';
  const dept_id         = req.body.dept_id ? parseInt(req.body.dept_id, 10) : null;
  const target_course   = req.body.target_course ? req.body.target_course.trim() : '';
  const location        = req.body.location ? req.body.location.trim() : '';
  const max_volunteers  = parseInt(req.body.max_volunteers, 10) || 0;
  const estimated_hours = parseInt(req.body.estimated_hours, 10) || 0;
  const target_date     = req.body.target_date ? req.body.target_date.trim() : '';
  const description     = req.body.description ? req.body.description.trim() : '';
  const agency_id       = req.body.agency_id ? parseInt(req.body.agency_id, 10) : null;
  const lifespan_days   = req.body.lifespan_days ? parseInt(req.body.lifespan_days, 10) : 14;

  // Automatic Status: Always set to 'Pending' for OLLCF Extension Office review
  const status          = 'Pending';

  if (!title || !target_date || !target_course) {
    return res.status(400).json({ error: "Title, Target Date, and Required Course are required fields." });
  }

  try {
    // Calculate validity expiration date
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + lifespan_days);

    const insert_sql = `
      INSERT INTO programs_activities 
      (title, dept_id, agency_id, target_course, location, max_volunteers, estimated_hours, description, target_date, status, expires_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING activity_id, expires_at
    `;

    const values = [
      title, 
      dept_id,
      agency_id,
      target_course || 'All Courses', 
      location, 
      max_volunteers, 
      estimated_hours, 
      description, 
      target_date, 
      status,
      expires_at
    ];

    const { rows } = await pool.query(insert_sql, values);

    res.json({
      success: true,
      message: "Activity proposal submitted successfully! Pending OLLCF Extension Office review.",
      activity_id: rows[0].activity_id,
      expires_at: rows[0].expires_at
    });
  } catch (err) {
    console.error('Propose Activity Error:', err);
    res.status(500).json({ error: "Failed to submit activity proposal: " + err.message });
  }
};

// --- 3. PROPOSE NEW COMMUNITY EXTENSION ACTIVITY ---
router.post('/activities', handleProposeActivity);
router.post('/activities/propose', handleProposeActivity);

// --- 4. FETCH ALL APPROVED ACTIVITIES FOR VENUE PIN MANAGER ---
// GET /api/lgu/pin-activities - Fetch ALL approved activities
router.get('/pin-activities', async (req, res) => {
  try {
    const query = `
      SELECT p.activity_id, p.title, p.target_date, p.location, p.estimated_hours,
             p.time_in_passcode, p.time_out_passcode,
             COALESCE(d.dept_name, 'Main LGU Office') AS dept_name
      FROM programs_activities p
      LEFT JOIN lgu_departments d ON p.dept_id = d.dept_id
      WHERE p.status = 'Approved'
      ORDER BY p.target_date DESC
    `;
    const { rows } = await pool.query(query);

    res.json({ success: true, activities: rows });
  } catch (err) {
    console.error('Fetch PIN Activities Error:', err);
    res.status(500).json({ error: 'Failed to retrieve activities for PIN management.' });
  }
});

// --- 5. SET & MANAGE ON-SITE ATTENDANCE PIN PASSCODES ---
router.post('/attendance/pins', async (req, res) => {
  const { activity_id, time_in_passcode, time_out_passcode } = req.body;

  if (!activity_id || !time_in_passcode || !time_out_passcode) {
    return res.status(400).json({ error: 'Activity ID and both 4-digit PINs are required.' });
  }

  try {
    const updateQuery = `
      UPDATE programs_activities 
      SET time_in_passcode = $1, time_out_passcode = $2 
      WHERE activity_id = $3 AND status = 'Approved'
    `;
    const result = await pool.query(updateQuery, [time_in_passcode.toString(), time_out_passcode.toString(), activity_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Approved activity not found.' });
    }

    res.json({ success: true, message: 'Attendance PIN passcodes updated successfully!' });
  } catch (err) {
    console.error('Manage PINs Error:', err);
    res.status(500).json({ error: 'Failed to update venue PIN passcodes.' });
  }
});

// --- 6. PROPONENT LGU SUB-DEPARTMENT / BARANGAY DROPDOWN FETCH ---
router.get('/departments', async (req, res) => {
  try {
    const query = "SELECT dept_id, dept_name, office_type FROM lgu_departments ORDER BY office_type ASC, dept_name ASC";
    const { rows } = await pool.query(query);

    const formattedDepartments = rows.map(dept => ({
      dept_id: dept.dept_id,
      dept_name: `${dept.dept_name} (${dept.office_type})`
    }));

    res.json({ success: true, departments: formattedDepartments });
  } catch (err) {
    console.error('Fetch Departments Error:', err);
    res.status(500).json({ error: 'Failed to retrieve LGU departments.' });
  }
});

// --- 7. ADD NEW LGU DEPARTMENT / BARANGAY ---
router.post('/departments', async (req, res) => {
  const { dept_name, office_type, contact_person, contact_email } = req.body;

  if (!dept_name) {
    return res.status(400).json({ error: 'Department or Barangay name is required.' });
  }

  try {
    const insertQuery = `
      INSERT INTO lgu_departments (dept_name, office_type, contact_person, contact_email)
      VALUES ($1, $2, $3, $4)
      RETURNING dept_id
    `;
    const values = [
      dept_name.trim(),
      office_type || 'Department',
      contact_person ? contact_person.trim() : null,
      contact_email ? contact_email.trim() : null
    ];

    const { rows } = await pool.query(insertQuery, values);
    res.json({ success: true, message: 'Office/Barangay added successfully!', dept_id: rows[0].dept_id });
  } catch (err) {
    console.error('Create Department Error:', err);
    res.status(500).json({ error: 'Failed to add office/barangay unit.' });
  }
});

module.exports = router;

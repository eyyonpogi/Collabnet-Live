const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Security Guard: Restrict access exclusively to OLLCF Admin users
router.use(requireAuth, requireRole('Admin'));

// --- 1. ADMIN DASHBOARD METRICS & SUMMARY ---
router.get('/dashboard', async (req, res) => {
  try {
    // Auto-Expire MOAs: Flag past partnership agreements as Expired
    await pool.query(
      "UPDATE partnerships SET status = 'Expired' WHERE end_date < CURRENT_DATE AND status != 'Expired'"
    );

    // Auto-Expire Pending Activities: Mark overdue pending proposals as Expired
    await pool.query(`
      UPDATE public.programs_activities
      SET status = 'Expired'
      WHERE status = 'Pending' AND expires_at < CURRENT_TIMESTAMP
    `);

    // Operational KPI Queries
    const pendingStudentsRes = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'Student' AND verification_status = 'Pending'"
    );
    const pendingProposalsRes = await pool.query(
      "SELECT COUNT(*) as count FROM programs_activities WHERE status = 'Pending'"
    );
    const activeMoasRes = await pool.query(
      "SELECT COUNT(*) as count FROM partnerships WHERE status = 'Active'"
    );
    const approvedActivitiesRes = await pool.query(
      "SELECT COUNT(*) as count FROM programs_activities WHERE status = 'Approved'"
    );

    // Queue Feeds: Pending Proposals & Pending Student Reviews
    const proposalsFeed = await pool.query(
      "SELECT activity_id, title, target_course, location, target_date FROM programs_activities WHERE status = 'Pending' ORDER BY target_date ASC LIMIT 5"
    );
    const studentsFeed = await pool.query(
      "SELECT user_id, full_name, student_id, course FROM users WHERE role = 'Student' AND verification_status = 'Pending' LIMIT 5"
    );

    res.json({
      success: true,
      metrics: {
        pendingStudents: parseInt(pendingStudentsRes.rows[0].count, 10),
        pendingProposals: parseInt(pendingProposalsRes.rows[0].count, 10),
        activeMoas: parseInt(activeMoasRes.rows[0].count, 10),
        approvedActivities: parseInt(approvedActivitiesRes.rows[0].count, 10)
      },
      feeds: {
        pendingProposals: proposalsFeed.rows,
        pendingStudents: studentsFeed.rows
      }
    });
  } catch (err) {
    console.error('Admin Dashboard Error:', err);
    res.status(500).json({ error: 'Failed to retrieve admin dashboard metrics.' });
  }
});

// --- 2. STUDENT ENROLLMENT VERIFICATION ---
router.get('/students', async (req, res) => {
  try {
    const pending = await pool.query(
      "SELECT user_id, full_name, student_id, course, email, verification_status FROM users WHERE role = 'Student' AND verification_status = 'Pending' ORDER BY user_id DESC"
    );
    const verified = await pool.query(
      "SELECT user_id, full_name, student_id, course, email, verification_status FROM users WHERE role = 'Student' AND verification_status = 'Approved' ORDER BY full_name ASC"
    );

    res.json({
      success: true,
      pendingStudents: pending.rows,
      verifiedStudents: verified.rows
    });
  } catch (err) {
    console.error('Student List Error:', err);
    res.status(500).json({ error: 'Failed to fetch student lists.' });
  }
});

// Approve or Reject Student Verification
router.post('/students/verify', async (req, res) => {
  const { user_id, action } = req.body;
  const adminId = req.session.user_id;

  if (!user_id || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid student user ID or verification action.' });
  }

  try {
    const newStatus = action === 'approve' ? 'Approved' : 'Rejected';
    const isVerified = action === 'approve';

    await pool.query(
      'UPDATE users SET verification_status = $1, is_verified = $2 WHERE user_id = $3',
      [newStatus, isVerified, user_id]
    );

    // Log decision in audit trail
    const logAction = `${action === 'approve' ? 'Approved' : 'Rejected'} Student Account ID #${user_id}`;
    await pool.query(
      'INSERT INTO activity_logs (user_id, action_taken) VALUES ($1, $2)',
      [adminId, logAction]
    );

    res.json({ success: true, message: `Student account ${newStatus.toLowerCase()} successfully.` });
  } catch (err) {
    console.error('Student Verification Error:', err);
    res.status(500).json({ error: 'Failed to update student verification status.' });
  }
});

// --- 3. GET ALL ACTIVITIES WITH AUTO-EXPIRATION CHECK ---
router.get('/activities', async (req, res) => {
  try {
    // Mark overdue pending proposals as 'Expired'
    await pool.query(`
      UPDATE public.programs_activities
      SET status = 'Expired'
      WHERE status = 'Pending' AND expires_at < CURRENT_TIMESTAMP
    `);

    // Fetch all activities with rejection reasons and validity dates
    const query = `
      SELECT 
        a.*, 
        ag.agency_name, 
        d.dept_name 
      FROM public.programs_activities a
      LEFT JOIN public.agencies ag ON a.agency_id = ag.agency_id
      LEFT JOIN public.lgu_departments d ON a.dept_id = d.dept_id
      ORDER BY a.activity_id DESC;
    `;
    const { rows } = await pool.query(query);
    res.json({ success: true, activities: rows });
  } catch (err) {
    console.error('Error fetching activities:', err);
    res.status(500).json({ error: 'Server error while fetching activities.' });
  }
});

// --- 4. EXTENSION ACTIVITY PROPOSALS EVALUATION ---
router.post('/activities/evaluate', async (req, res) => {
  const { activity_id, decision, rejection_reason } = req.body;
  const adminId = req.session.user_id || req.session.userId;

  if (!activity_id || !['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'Invalid activity ID or evaluation decision.' });
  }

  // Validates rejection reason
  if (decision === 'reject' && (!rejection_reason || rejection_reason.trim() === '')) {
    return res.status(400).json({ error: 'A valid rejection reason is required when rejecting an activity.' });
  }

  try {
    const statusVal = decision === 'approve' ? 'Approved' : 'Rejected';
    const reasonText = decision === 'reject' ? rejection_reason.trim() : null;

    // Updates status and rejection_reason in programs_activities
    await pool.query(
      'UPDATE programs_activities SET status = $1, rejection_reason = $2 WHERE activity_id = $3',
      [statusVal, reasonText, activity_id]
    );

    // Writes audit log to activity_logs table
    let logText = `Extension Activity ID #${activity_id} was ${statusVal.toLowerCase()} by ${req.session.full_name || 'Extension Director'}`;
    if (decision === 'reject') {
      logText += `. Reason: ${reasonText}`;
    }

    await pool.query(
      'INSERT INTO activity_logs (activity_id, user_id, action_taken) VALUES ($1, $2, $3)',
      [activity_id, adminId, logText]
    );

    res.json({ success: true, message: `Activity proposal marked as ${statusVal}.` });
  } catch (err) {
    console.error('Proposal Evaluation Error:', err);
    res.status(500).json({ error: 'Failed to evaluate activity proposal.' });
  }
});

// --- 5. ATTENDANCE & CERTIFICATE AUDIT ---
router.get('/attendance/audit/:activityId', async (req, res) => {
  const activityId = parseInt(req.params.activityId, 10);

  if (!activityId) {
    return res.status(400).json({ error: 'Valid activity ID required.' });
  }

  try {
    const actQuery = `
      SELECT p.*, d.dept_name 
      FROM programs_activities p 
      LEFT JOIN lgu_departments d ON p.dept_id = d.dept_id 
      WHERE p.activity_id = $1
    `;
    const actRes = await pool.query(actQuery, [activityId]);

    if (actRes.rows.length === 0) {
      return res.status(404).json({ error: 'Extension activity not found.' });
    }

    const participantsQuery = `
      SELECT ap.*, 
             COALESCE(ap.time_in, ap.time_in_at) AS formatted_time_in,
             COALESCE(ap.time_out, ap.time_out_at) AS formatted_time_out,
             u.full_name, u.student_id, u.email,
             p.estimated_hours AS target_hours
      FROM activity_participants ap
      JOIN users u ON ap.user_id = u.user_id
      JOIN programs_activities p ON ap.activity_id = p.activity_id
      WHERE ap.activity_id = $1
      ORDER BY u.full_name ASC
    `;
    const participantsRes = await pool.query(participantsQuery, [activityId]);

    res.json({
      success: true,
      activity: actRes.rows[0],
      participants: participantsRes.rows
    });
  } catch (err) {
    console.error('Attendance Audit Error:', err);
    res.status(500).json({ error: 'Failed to load attendance audit log.' });
  }
});

// Award Certificate and Verify Service Hours Completion
router.post('/attendance/verify-certificate', async (req, res) => {
  const { participant_id } = req.body;

  if (!participant_id) {
    return res.status(400).json({ error: 'Participant ID is required.' });
  }

  try {
    // Ensure participant completed both Time-In and Time-Out
    const checkQuery = `
      SELECT COALESCE(time_in, time_in_at) AS actual_time_in,
             COALESCE(time_out, time_out_at) AS actual_time_out
      FROM activity_participants
      WHERE participant_id = $1
    `;
    const checkRes = await pool.query(checkQuery, [participant_id]);

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Participant record not found.' });
    }

    const { actual_time_in, actual_time_out } = checkRes.rows[0];

    if (!actual_time_in || !actual_time_out) {
      return res.status(400).json({ error: 'Cannot award certificate! Student must log both Time-In and Time-Out.' });
    }

    await pool.query(
      "UPDATE activity_participants SET status = 'Completed', certificate_issued = TRUE, verified_at = CURRENT_TIMESTAMP WHERE participant_id = $1",
      [participant_id]
    );

    res.json({ success: true, message: 'Student participation verified! Certificate awarded and service hours updated.' });
  } catch (err) {
    console.error('Certificate Award Error:', err);
    res.status(500).json({ error: 'Failed to issue certificate.' });
  }
});

router.get('/activities/approved', async (req, res) => {
  try {
    const query = `
      SELECT activity_id, title, target_date, target_course, estimated_hours
      FROM programs_activities
      WHERE status = 'Approved'
      ORDER BY target_date DESC
    `;
    const { rows } = await pool.query(query);
    res.json({ success: true, activities: rows });
  } catch (err) {
    console.error('Fetch Approved Activities Error:', err);
    res.status(500).json({ error: 'Failed to fetch approved activities.' });
  }
});

// --- 6. LIST & FILTER ACTIVITIES BY STATUS ---
router.get('/activities/list', async (req, res) => {
  const status = req.query.status || 'Pending';

  try {
    // Auto-expire check before filtering
    await pool.query(`
      UPDATE public.programs_activities
      SET status = 'Expired'
      WHERE status = 'Pending' AND expires_at < CURRENT_TIMESTAMP
    `);

    let query = `
      SELECT p.activity_id, p.title, p.description, p.target_course, p.location, 
             p.target_date, p.estimated_hours, p.max_volunteers, p.status, p.rejection_reason, p.expires_at,
             d.dept_name 
      FROM programs_activities p
      LEFT JOIN lgu_departments d ON p.dept_id = d.dept_id
    `;
    const params = [];

    if (status !== 'All') {
      query += ` WHERE p.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY p.target_date DESC`;

    const { rows } = await pool.query(query, params);
    
    res.json({ success: true, activities: rows, filterStatus: status });
  } catch (err) {
    console.error('Fetch Admin Activities Error:', err);
    res.status(500).json({ error: 'Failed to retrieve extension activities.', details: err.message });
  }
});

module.exports = router;
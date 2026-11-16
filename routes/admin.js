const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Security Guard: Restrict access exclusively to OLLCF Admin users
router.use(requireAuth, requireRole('Admin'));

// --- 1. ADMIN DASHBOARD METRICS & SUMMARY ---
router.get('/dashboard', async (req, res) => {
  try {
    await pool.query(
      "UPDATE partnerships SET status = 'Expired' WHERE end_date < CURRENT_DATE AND status != 'Expired'"
    );

    await pool.query(`
      UPDATE public.programs_activities
      SET status = 'Expired'
      WHERE status = 'Pending' AND expires_at < CURRENT_TIMESTAMP
    `);

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

    const proposalsFeed = await pool.query(
      "SELECT activity_id, title, target_course, location, target_date FROM programs_activities WHERE status = 'Pending' ORDER BY activity_id DESC LIMIT 5"
    );
    const studentsFeed = await pool.query(
      "SELECT user_id, full_name, student_id, course FROM users WHERE role = 'Student' AND verification_status = 'Pending' ORDER BY user_id DESC LIMIT 5"
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
      `SELECT user_id, full_name, student_id, course, email, verification_status, 
              verification_doc_name, (verification_doc IS NOT NULL) AS has_doc, created_at
       FROM users 
       WHERE role = 'Student' AND verification_status = 'Pending' 
       ORDER BY user_id DESC`
    );
    const verified = await pool.query(
      `SELECT user_id, full_name, student_id, course, email, verification_status, 
              verification_doc_name, (verification_doc IS NOT NULL) AS has_doc, created_at
       FROM users 
       WHERE role = 'Student' AND verification_status = 'Approved' 
       ORDER BY user_id DESC`
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

// GET: View Full Student Details & Uploaded School ID / COR Before Approval
router.get('/students/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);

  if (!userId) {
    return res.status(400).json({ error: 'Invalid student user ID.' });
  }

  try {
    const result = await pool.query(
      `SELECT user_id, full_name, student_id, course, email, verification_status, 
              verification_doc, verification_doc_name, created_at
       FROM users 
       WHERE user_id = $1 AND role = 'Student'`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student record not found.' });
    }

    res.json({
      success: true,
      student: result.rows[0]
    });
  } catch (err) {
    console.error('Fetch Student Details Error:', err);
    res.status(500).json({ error: 'Failed to load student details.' });
  }
});

// Approve or Reject Student Verification
router.post('/students/verify', async (req, res) => {
  const { user_id, action } = req.body;
  const adminId = req.session?.user_id || req.user?.user_id;

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
    await pool.query(`
      UPDATE public.programs_activities
      SET status = 'Expired'
      WHERE status = 'Pending' AND expires_at < CURRENT_TIMESTAMP
    `);

    const query = `
      SELECT 
        a.activity_id, a.title, a.description, a.target_course, a.location,
        a.target_date, a.previous_target_date, a.reschedule_reason, a.rescheduled_at,
        a.estimated_hours, a.max_volunteers, a.status, a.rejection_reason,
        a.proposal_doc_name, (a.proposal_doc IS NOT NULL) AS has_attachment,
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

// GET: Download / Inspect Proposal Attachment Before Approval
router.get('/activities/:activityId/attachment', async (req, res) => {
  const activityId = parseInt(req.params.activityId, 10);

  if (!activityId) {
    return res.status(400).json({ error: 'Invalid activity ID.' });
  }

  try {
    const result = await pool.query(
      'SELECT title, proposal_doc, proposal_doc_name FROM programs_activities WHERE activity_id = $1',
      [activityId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Extension activity not found.' });
    }

    const row = result.rows[0];
    if (!row.proposal_doc) {
      return res.status(404).json({ error: 'No downloadable attachment was provided for this activity.' });
    }

    res.json({
      success: true,
      title: row.title,
      proposal_doc: row.proposal_doc,
      proposal_doc_name: row.proposal_doc_name || `Activity_${activityId}_Proposal`
    });
  } catch (err) {
    console.error('Fetch Activity Attachment Error:', err);
    res.status(500).json({ error: 'Failed to retrieve activity attachment.' });
  }
});

// PUT: Reschedule Extension Activity (Admin / Extension Director)
router.put('/activities/:activityId/reschedule', async (req, res) => {
  const activityId = parseInt(req.params.activityId, 10);
  const { new_target_date, reschedule_reason } = req.body;
  const adminId = req.session?.user_id || req.user?.user_id;

  if (!activityId || !new_target_date) {
    return res.status(400).json({ error: 'Activity ID and new target date are required.' });
  }

  try {
    const existingRes = await pool.query(
      'SELECT activity_id, title, target_date, status FROM programs_activities WHERE activity_id = $1',
      [activityId]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Extension activity not found.' });
    }

    const act = existingRes.rows[0];
    const oldDateStr = act.target_date ? new Date(act.target_date).toISOString().split('T')[0] : 'N/A';

    if (oldDateStr === new_target_date) {
      return res.status(400).json({ error: 'New target date must be different from the current scheduled date.' });
    }

    const cleanReason = reschedule_reason && reschedule_reason.trim() !== ''
      ? reschedule_reason.trim()
      : null;

    await pool.query(
      `UPDATE programs_activities
       SET previous_target_date = target_date,
           target_date = $1,
           reschedule_reason = $2,
           rescheduled_at = CURRENT_TIMESTAMP
       WHERE activity_id = $3`,
      [new_target_date, cleanReason, activityId]
    );

    const reviewerName = req.session?.full_name || req.user?.full_name || 'Extension Director';
    let logText = `Extension Director (${reviewerName}) rescheduled '${act.title}' from ${oldDateStr} to ${new_target_date}`;
    if (cleanReason) {
      logText += `. Reason: ${cleanReason}`;
    }

    await pool.query(
      'INSERT INTO activity_logs (activity_id, user_id, action_taken) VALUES ($1, $2, $3)',
      [activityId, adminId, logText]
    );

    res.json({
      success: true,
      message: `Activity '${act.title}' rescheduled from ${oldDateStr} to ${new_target_date}.`
    });
  } catch (err) {
    console.error('Admin Reschedule Activity Error:', err);
    res.status(500).json({ error: 'Failed to reschedule activity.' });
  }
});

// --- 4. EXTENSION ACTIVITY PROPOSALS EVALUATION ---
router.post('/activities/evaluate', async (req, res) => {
  const { activity_id, decision, rejection_reason } = req.body;
  const adminId = req.session?.user_id || req.user?.user_id;

  if (!activity_id || !['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'Invalid activity ID or evaluation decision.' });
  }

  if (decision === 'reject' && (!rejection_reason || rejection_reason.trim() === '')) {
    return res.status(400).json({ error: 'A valid rejection reason is required when rejecting an activity.' });
  }

  try {
    const statusVal = decision === 'approve' ? 'Approved' : 'Rejected';
    const reasonText = decision === 'reject' ? rejection_reason.trim() : null;

    await pool.query(
      'UPDATE programs_activities SET status = $1, rejection_reason = $2 WHERE activity_id = $3',
      [statusVal, reasonText, activity_id]
    );

    const reviewerName = req.session?.full_name || req.user?.full_name || 'Extension Director';
    let logText = `Extension Activity ID #${activity_id} was ${statusVal.toLowerCase()} by ${reviewerName}`;
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

// --- 5. AUTOMATED ATTENDANCE & CERTIFICATE AUDIT LOGS ---
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
             u.full_name, u.student_id, u.email, u.course,
             p.estimated_hours AS target_hours
      FROM activity_participants ap
      JOIN users u ON ap.user_id = u.user_id
      JOIN programs_activities p ON ap.activity_id = p.activity_id
      WHERE ap.activity_id = $1
      ORDER BY ap.participant_id DESC
    `;
    const participantsRes = await pool.query(participantsQuery, [activityId]);

    const auditRecords = participantsRes.rows.map(row => {
      const rendered = parseFloat(row.hours_rendered || 0);
      const target = parseFloat(row.target_hours || 0);

      const isCompleted = row.target_reached === true || (rendered >= target && target > 0) || row.certificate_issued === true;
      const isEarlyOut = !isCompleted && Boolean(row.early_out_reason);

      let certNo = row.certificate_no;
      if (!certNo && isCompleted) {
        certNo = `CERT-2026-${row.participant_id.toString().padStart(5, '0')}`;
      }

      return {
        ...row,
        hours_rendered: rendered,
        target_hours: target,
        certificate_no: certNo,
        is_eligible: isCompleted,
        is_early_out: isEarlyOut
      };
    });

    res.json({
      success: true,
      activity: actRes.rows[0],
      participants: auditRecords
    });
  } catch (err) {
    console.error('Attendance Audit Error:', err);
    res.status(500).json({ error: 'Failed to load attendance audit log.' });
  }
});

router.get('/activities/approved', async (req, res) => {
  try {
    const query = `
      SELECT activity_id, title, target_date, target_course, estimated_hours
      FROM programs_activities
      WHERE status = 'Approved'
      ORDER BY activity_id DESC
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
    await pool.query(`
      UPDATE public.programs_activities
      SET status = 'Expired'
      WHERE status = 'Pending' AND expires_at < CURRENT_TIMESTAMP
    `);

    let query = `
      SELECT p.activity_id, p.title, p.description, p.target_course, p.location, 
             p.target_date, p.previous_target_date, p.reschedule_reason, p.rescheduled_at,
             p.estimated_hours, p.max_volunteers, p.status, p.rejection_reason, p.expires_at,
             p.proposal_doc_name, (p.proposal_doc IS NOT NULL) AS has_attachment,
             d.dept_name 
      FROM programs_activities p
      LEFT JOIN lgu_departments d ON p.dept_id = d.dept_id
    `;
    const params = [];

    if (status !== 'All') {
      query += ` WHERE p.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY p.activity_id DESC`;

    const { rows } = await pool.query(query, params);
    
    res.json({ success: true, activities: rows, filterStatus: status });
  } catch (err) {
    console.error('Fetch Admin Activities Error:', err);
    res.status(500).json({ error: 'Failed to retrieve extension activities.', details: err.message });
  }
});

module.exports = router;
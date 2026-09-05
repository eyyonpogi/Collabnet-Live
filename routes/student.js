const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Protect all routes in this module for authenticated Students
router.use(requireAuth, requireRole('Student'));

// --- 1. STUDENT DASHBOARD STATS & RECENT ACTIVITIES ---
router.get('/dashboard', async (req, res) => {
  const userId = req.session.user_id;

  try {
    const statsQuery = `
      SELECT COUNT(*) AS joined_count, COALESCE(SUM(hours_rendered), 0) AS total_hours
      FROM activity_participants
      WHERE user_id = $1
    `;
    const statsRes = await pool.query(statsQuery, [userId]);

    const unreadQuery = `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE`;
    const unreadRes = await pool.query(unreadQuery, [userId]);

    const activitiesQuery = `
      SELECT a.activity_id, a.title, a.target_date, a.description, a.status, a.estimated_hours,
             p.participant_id IS NOT NULL AS is_joined,
             p.hours_rendered, p.target_reached,
             COALESCE(p.time_in, p.time_in_at) AS formatted_time_in,
             COALESCE(p.time_out, p.time_out_at) AS formatted_time_out
      FROM programs_activities a
      LEFT JOIN activity_participants p ON a.activity_id = p.activity_id AND p.user_id = $1
      WHERE a.status IN ('Approved', 'Completed')
      ORDER BY a.target_date DESC LIMIT 4
    `;
    const activitiesRes = await pool.query(activitiesQuery, [userId]);

    res.json({
      success: true,
      stats: {
        joinedCount: parseInt(statsRes.rows[0].joined_count, 10),
        totalHours: parseFloat(statsRes.rows[0].total_hours),
        unreadNotifications: parseInt(unreadRes.rows[0].count, 10)
      },
      activities: activitiesRes.rows
    });
  } catch (err) {
    console.error('Student Dashboard Error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

// --- 2. AVAILABLE OUTREACH ACTIVITIES ---
router.get('/activities', async (req, res) => {
  const userId = req.session.user_id;

  try {
    const userRes = await pool.query('SELECT course FROM users WHERE user_id = $1', [userId]);
    const studentCourse = (userRes.rows[0]?.course || '').trim();

    const query = `
      SELECT a.activity_id, a.title, a.target_course, a.location, a.max_volunteers,
             a.estimated_hours, a.target_date, a.description, a.status,
             p.participant_id IS NOT NULL AS is_joined,
             COALESCE(p.time_in, p.time_in_at) AS time_in,
             COALESCE(p.time_out, p.time_out_at) AS time_out
      FROM programs_activities a
      LEFT JOIN activity_participants p ON a.activity_id = p.activity_id AND p.user_id = $1
      WHERE a.status IN ('Approved', 'Completed')
      ORDER BY a.target_date ASC
    `;
    const { rows } = await pool.query(query, [userId]);

    const activities = rows.map((act) => {
      const reqCourse = (act.target_course || 'All Courses').trim();
      const isEligible = reqCourse === 'All Courses' || reqCourse.toLowerCase() === studentCourse.toLowerCase();
      const hasAttendance = Boolean(act.time_in || act.time_out);
      return { ...act, is_eligible: isEligible, has_attendance: hasAttendance };
    });

    res.json({ success: true, studentCourse, activities });
  } catch (err) {
    console.error('Activities Error:', err);
    res.status(500).json({ error: 'Failed to fetch activities.' });
  }
});

// --- 3. PROCESS ACTIVITY (JOIN / LEAVE WITH ATTENDANCE LOCK & SCHEDULE CONFLICT CHECK) ---
router.post('/activities/join', async (req, res) => {
  const userId = req.session.user_id;
  const activity_id = parseInt(req.body.activity_id, 10) || 0;
  const action = req.body.action || 'join';

  if (activity_id <= 0) {
    return res.status(400).json({ error: 'Valid activity_id is required.' });
  }

  try {
    if (action === 'join') {
      const check_sql = `
        SELECT u.course AS student_course, a.target_course, a.target_date, a.title
        FROM users u, programs_activities a 
        WHERE u.user_id = $1 AND a.activity_id = $2
      `;
      const check_res = await pool.query(check_sql, [userId, activity_id]);

      if (check_res.rows.length === 0) {
        return res.status(404).json({ error: 'Activity or user record not found.' });
      }

      const info = check_res.rows[0];
      const student_course = (info.student_course || '').trim();
      const target_course = (info.target_course || '').trim();
      const target_date = info.target_date;

      const isEligible = target_course === 'All Courses' || target_course.toLowerCase() === student_course.toLowerCase();
      if (!isEligible) {
        return res.status(400).json({ error: `Course restriction: This activity is restricted to ${target_course} students.` });
      }

      const conflictCheck = await pool.query(
        `SELECT a.title, a.target_date 
         FROM activity_participants ap
         JOIN programs_activities a ON ap.activity_id = a.activity_id
         WHERE ap.user_id = $1 AND a.target_date = $2 AND ap.activity_id != $3`,
        [userId, target_date, activity_id]
      );

      if (conflictCheck.rows.length > 0) {
        const conflictTitle = conflictCheck.rows[0].title;
        const formattedDate = new Date(target_date).toISOString().split('T')[0];
        return res.status(400).json({
          error: `Schedule Conflict: You are already registered for "${conflictTitle}" on ${formattedDate}.`
        });
      }

      const insert_sql = `
        INSERT INTO activity_participants (activity_id, user_id, status) 
        VALUES ($1, $2, 'Registered') 
        ON CONFLICT (activity_id, user_id) DO UPDATE SET status = 'Registered'
      `;
      await pool.query(insert_sql, [activity_id, userId]);

      return res.json({ success: true, message: 'Successfully registered for extension activity!' });

    } else if (action === 'leave') {
      // Attendance Lock Check: Prevent leaving if Time-In or Time-Out has been recorded
      const checkAttendance = await pool.query(
        `SELECT COALESCE(time_in, time_in_at) AS time_in, COALESCE(time_out, time_out_at) AS time_out, status 
         FROM activity_participants 
         WHERE activity_id = $1 AND user_id = $2`,
        [activity_id, userId]
      );

      if (checkAttendance.rows.length > 0) {
        const record = checkAttendance.rows[0];
        const hasTimeIn = Boolean(record.time_in);
        const hasTimeOut = Boolean(record.time_out);

        if (hasTimeIn || hasTimeOut || record.status === 'Completed') {
          return res.status(400).json({
            error: 'Action Denied: You cannot leave an activity after Time-In or Time-Out attendance has been recorded.'
          });
        }
      }

      const delete_sql = 'DELETE FROM activity_participants WHERE activity_id = $1 AND user_id = $2';
      await pool.query(delete_sql, [activity_id, userId]);

      return res.json({ success: true, message: 'Successfully left activity registration.' });
    }

    res.status(400).json({ error: 'Invalid action parameter specified.' });

  } catch (err) {
    console.error('Process Activity Error:', err);
    res.status(500).json({ error: 'Failed to process activity request: ' + err.message });
  }
});

// --- 4. SUBMIT ON-SITE ATTENDANCE PIN ---
router.post('/attendance/pin', async (req, res) => {
  const userId = req.session.user_id;
  const { activity_id, pin, action_type, confirm_early } = req.body;

  if (!pin || !activity_id || !action_type) {
    return res.status(400).json({ error: 'Activity ID, PIN, and action type are required.' });
  }

  try {
    const actRes = await pool.query(
      'SELECT title, estimated_hours, time_in_passcode, time_out_passcode FROM programs_activities WHERE activity_id = $1',
      [activity_id]
    );

    if (actRes.rows.length === 0) {
      return res.status(404).json({ error: 'Activity not found.' });
    }

    const activity = actRes.rows[0];

    // Safe NULL Checks for Venue PIN Configuration
    if (action_type === 'time_in' && !activity.time_in_passcode) {
      return res.status(400).json({ 
        error: 'Time-In PIN passcode has not been set by the organizer for this activity yet.' 
      });
    }

    if (action_type === 'time_out' && !activity.time_out_passcode) {
      return res.status(400).json({ 
        error: 'Time-Out PIN passcode has not been set by the organizer for this activity yet.' 
      });
    }

    const partRes = await pool.query(
      'SELECT participant_id FROM activity_participants WHERE activity_id = $1 AND user_id = $2',
      [activity_id, userId]
    );

    if (partRes.rows.length === 0) {
      return res.status(400).json({ error: 'You have not registered for this activity yet.' });
    }

    const participantId = partRes.rows[0].participant_id;

    if (action_type === 'time_in') {
      if (pin.toString().trim() !== activity.time_in_passcode.toString().trim()) {
        return res.status(400).json({ error: 'Invalid Time-In PIN passcode.' });
      }

      await pool.query(
        'UPDATE activity_participants SET time_in = CURRENT_TIMESTAMP, time_in_at = CURRENT_TIMESTAMP WHERE participant_id = $1',
        [participantId]
      );
      return res.json({ success: true, message: `Time-In recorded for '${activity.title}'!` });
    } 

    if (action_type === 'time_out') {
      if (pin.toString().trim() !== activity.time_out_passcode.toString().trim()) {
        return res.status(400).json({ error: 'Invalid Time-Out PIN passcode.' });
      }

      const timeInCheck = await pool.query(
        'SELECT COALESCE(time_in, time_in_at) AS time_in FROM activity_participants WHERE participant_id = $1',
        [participantId]
      );

      if (!timeInCheck.rows[0] || !timeInCheck.rows[0].time_in) {
        return res.status(400).json({ error: 'You must record Time-In before recording Time-Out.' });
      }

      const timeIn = timeInCheck.rows[0].time_in;
      const now = new Date();
      const timeInMs = new Date(timeIn).getTime();
      const nowMs = now.getTime();
      const diffMs = Math.max(0, nowMs - timeInMs);
      const hoursRendered = Math.round((diffMs / 3600000) * 100) / 100 || 0;
      const targetHours = parseFloat(activity.estimated_hours) || 0;

      if (targetHours > 0 && hoursRendered < targetHours && !confirm_early) {
        return res.json({
          success: false,
          requires_confirmation: true,
          hoursRendered,
          targetHours,
          message: `Target hours not reached! You rendered ${hoursRendered} hrs out of ${targetHours} required hrs.`
        });
      }

      await pool.query(
        'UPDATE activity_participants SET time_out = CURRENT_TIMESTAMP, time_out_at = CURRENT_TIMESTAMP WHERE participant_id = $1',
        [participantId]
      );

      const targetReached = targetHours > 0 ? hoursRendered >= targetHours : true;

      await pool.query(
        'UPDATE activity_participants SET hours_rendered = $1, target_reached = $2, status = $3 WHERE participant_id = $4',
        [hoursRendered, targetReached, 'Completed', participantId]
      );

      return res.json({
        success: true,
        message: `Time-Out recorded! Rendered: ${hoursRendered} / ${targetHours} hrs.`,
        hoursRendered,
        targetReached
      });
    }

    res.status(400).json({ error: 'Invalid action type specified.' });
  } catch (err) {
    console.error('PIN Attendance Error:', err);
    res.status(500).json({ error: 'Failed to process attendance PIN: ' + err.message });
  }
});

// --- 5. GET STUDENT ACTIVITY PARTICIPATION HISTORY & LOGS ---
const handleFetchAttendanceLogs = async (req, res) => {
  const userId = req.session.user_id;

  try {
    const query = `
      SELECT a.activity_id, a.title, a.location, a.target_date, a.estimated_hours,
             p.participant_id, p.status AS participant_status, p.certificate_issued, p.hours_rendered, p.target_reached,
             COALESCE(p.time_in, p.time_in_at) AS formatted_time_in,
             COALESCE(p.time_out, p.time_out_at) AS formatted_time_out
      FROM activity_participants p
      JOIN programs_activities a ON p.activity_id = a.activity_id
      WHERE p.user_id = $1
      ORDER BY a.target_date DESC
    `;
    const { rows } = await pool.query(query, [userId]);

    res.json({ success: true, logs: rows, history: rows });
  } catch (err) {
    console.error('Fetch Activity History Error:', err);
    res.status(500).json({ error: 'Failed to retrieve participation history.' });
  }
};

// Aliased to satisfy both /attendance/logs and /attendance/history frontend calls
router.get('/attendance/logs', handleFetchAttendanceLogs);
router.get('/attendance/history', handleFetchAttendanceLogs);

// --- 6. GET STUDENT PROFILE DETAILS ---
router.get('/profile', async (req, res) => {
  const userId = req.session.user_id;

  try {
    const userSql = `
      SELECT full_name, student_id, course, email, verification_status 
      FROM users 
      WHERE user_id = $1
    `;
    const userRes = await pool.query(userSql, [userId]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Student profile not found.' });
    }

    const statsSql = `
      SELECT COUNT(*) AS joined_count, COALESCE(SUM(hours_rendered), 0) AS total_hours
      FROM activity_participants 
      WHERE user_id = $1
    `;
    const statsRes = await pool.query(statsSql, [userId]);

    const user = userRes.rows[0];
    const stats = statsRes.rows[0];

    res.json({
      success: true,
      profile: {
        fullName: user.full_name,
        studentId: user.student_id,
        course: user.course,
        email: user.email,
        verificationStatus: user.verification_status
      },
      stats: {
        joinedCount: parseInt(stats.joined_count, 10),
        totalHours: parseFloat(stats.total_hours)
      }
    });
  } catch (err) {
    console.error('Fetch Profile Error:', err);
    res.status(500).json({ error: 'Failed to retrieve student profile.' });
  }
});

module.exports = router;
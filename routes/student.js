const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// GET: Fetch Student Dashboard Metrics & Recent Activities
router.get('/dashboard', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;

    try {
        // 1. Calculate Unread Notifications Count
        const unreadRes = await db.query(
            `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
            [user_id]
        );
        const unreadCount = parseInt(unreadRes.rows[0].count, 10) || 0;

        // 2. Calculate Service Hours & Joined Count
        const statsRes = await db.query(
            `SELECT 
                COUNT(*) AS joined_count,
                COALESCE(SUM(hours_rendered), 0) AS total_hours
             FROM activity_participants 
             WHERE user_id = $1`,
            [user_id]
        );
        const stats = statsRes.rows[0];

        // 3. Fetch Recent Activities with Join & Attendance Status
        const activitiesRes = await db.query(
            `SELECT a.activity_id, a.title, a.target_date, a.description, a.status, a.estimated_hours,
                    (p.participant_id IS NOT NULL) AS is_joined,
                    p.hours_rendered, p.target_reached, p.is_eligible_for_cert,
                    COALESCE(p.time_in, p.time_in_at) AS formatted_time_in,
                    COALESCE(p.time_out, p.time_out_at) AS formatted_time_out
             FROM programs_activities a
             LEFT JOIN activity_participants p ON a.activity_id = p.activity_id AND p.user_id = $1
             WHERE a.status IN ('Approved', 'Completed')
             ORDER BY a.target_date DESC LIMIT 4`,
            [user_id]
        );

        return res.json({
            success: true,
            user_name: req.user.full_name,
            unread_count: unreadCount,
            total_hours: parseFloat(stats.total_hours || 0),
            joined_count: parseInt(stats.joined_count || 0, 10),
            activities: activitiesRes.rows
        });
    } catch (err) {
        console.error('Student Dashboard Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to load dashboard statistics.' });
    }
});

// GET: Fetch Student Profile Details & Total Statistics
router.get('/profile', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;

    try {
        // 1. Fetch Student User Details
        const userRes = await db.query(
            `SELECT user_id, full_name, email, student_id, course, verification_status 
             FROM users WHERE user_id = $1`,
            [user_id]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Student profile not found.' });
        }

        const user = userRes.rows[0];

        // 2. Compute Aggregated Volunteer Metrics
        const statsRes = await db.query(
            `SELECT 
                COUNT(*) AS joined_count,
                COALESCE(SUM(hours_rendered), 0) AS total_hours
             FROM activity_participants 
             WHERE user_id = $1`,
            [user_id]
        );

        const stats = statsRes.rows[0];

        return res.json({
            success: true,
            profile: {
                fullName: user.full_name,
                email: user.email,
                studentId: user.student_id,
                course: user.course,
                verificationStatus: user.verification_status || 'Approved'
            },
            stats: {
                totalHours: parseFloat(stats.total_hours || 0),
                joinedCount: parseInt(stats.joined_count || 0, 10)
            }
        });
    } catch (err) {
        console.error('Fetch Profile Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to load profile details.' });
    }
});

// GET: Fetch All Approved Extension Activities for Student Activities Page
router.get('/activities', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;
    const user_course = req.user.course || req.user.target_course;

    try {
        const query = `
            SELECT 
                a.activity_id,
                a.title,
                a.description,
                a.location,
                a.target_date,
                a.estimated_hours,
                a.max_volunteers,
                a.target_course,
                (p.participant_id IS NOT NULL) AS is_joined,
                CASE 
                    WHEN a.target_course = 'All Courses' OR a.target_course = $2 THEN true 
                    ELSE false 
                END AS is_eligible
            FROM programs_activities a
            LEFT JOIN activity_participants p ON a.activity_id = p.activity_id AND p.user_id = $1
            WHERE a.status = 'Approved'
            ORDER BY a.target_date ASC
        `;
        const result = await db.query(query, [user_id, user_course]);

        return res.json({ success: true, activities: result.rows });
    } catch (err) {
        console.error('Fetch Activities Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch activities list.' });
    }
});

// POST: Join or Leave an Extension Activity with Schedule Conflict Prevention
router.post('/activities/join', verifyToken, async (req, res) => {
    const { activity_id, action } = req.body;
    const user_id = req.user.user_id;

    if (!activity_id) {
        return res.status(400).json({ success: false, message: 'Activity ID is required.' });
    }

    try {
        if (action === 'leave') {
            await db.query(
                `DELETE FROM activity_participants WHERE activity_id = $1 AND user_id = $2`,
                [activity_id, user_id]
            );
            return res.json({ success: true, message: 'Successfully left the activity.' });
        }

        // 1. Fetch Target Activity Date
        const targetActRes = await db.query(
            `SELECT activity_id, title, target_date FROM programs_activities WHERE activity_id = $1`,
            [activity_id]
        );
        if (targetActRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Activity not found.' });
        }
        const targetAct = targetActRes.rows[0];
        const targetDate = new Date(targetAct.target_date).toISOString().split('T')[0];

        // 2. Schedule Conflict Check (Check if student is already joined in another activity on the same date)
        const conflictRes = await db.query(
            `SELECT a.title 
             FROM activity_participants p
             JOIN programs_activities a ON p.activity_id = a.activity_id
             WHERE p.user_id = $1 
               AND p.activity_id != $2 
               AND DATE(a.target_date) = $3`,
            [user_id, activity_id, targetDate]
        );

        if (conflictRes.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Schedule Conflict: You are already registered for '${conflictRes.rows[0].title}' on ${targetDate}.` 
            });
        }

        // 3. Register Student for Activity
        await db.query(
            `INSERT INTO activity_participants (activity_id, user_id) 
             VALUES ($1, $2)
             ON CONFLICT (activity_id, user_id) DO NOTHING`,
            [activity_id, user_id]
        );

        return res.json({ success: true, message: `Successfully registered for '${targetAct.title}'!` });

    } catch (err) {
        console.error('Join/Leave Activity Error:', err);
        return res.status(500).json({ success: false, message: 'Server error processing registration request.' });
    }
});

// GET: Fetch Joined Activities for Attendance Logging
router.get('/attendance-list', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;

    try {
        const query = `
            SELECT 
                a.activity_id, 
                a.title, 
                a.target_date, 
                a.location, 
                a.estimated_hours,
                p.participant_id,
                p.hours_rendered,
                p.target_reached,
                p.early_out_reason,
                p.is_eligible_for_cert,
                COALESCE(p.time_in, p.time_in_at) AS time_in,
                COALESCE(p.time_out, p.time_out_at) AS time_out
            FROM activity_participants p
            JOIN programs_activities a ON p.activity_id = a.activity_id
            WHERE p.user_id = $1
            ORDER BY a.target_date DESC
        `;
        const result = await db.query(query, [user_id]);

        return res.json({ success: true, activities: result.rows });
    } catch (err) {
        console.error('Attendance List Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch attendance records.' });
    }
});

// POST: Time-In Venue PIN Submission
router.post('/time-in', verifyToken, async (req, res) => {
    const { activity_id, pin } = req.body;
    const user_id = req.user.user_id;

    if (!pin || !activity_id) {
        return res.status(400).json({ success: false, message: 'Activity ID and 4-digit PIN are required.' });
    }

    try {
        const actResult = await db.query(
            `SELECT activity_id, title, time_in_passcode FROM programs_activities WHERE activity_id = $1`,
            [activity_id]
        );

        if (actResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Activity not found.' });
        }
        const activity = actResult.rows[0];

        if (activity.time_in_passcode !== pin.trim()) {
            return res.status(400).json({ success: false, message: 'Invalid Time-In PIN! Please ask the venue coordinator.' });
        }

        const partResult = await db.query(
            `SELECT participant_id FROM activity_participants WHERE activity_id = $1 AND user_id = $2`,
            [activity_id, user_id]
        );

        if (partResult.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'You have not joined this activity yet.' });
        }

        const participant_id = partResult.rows[0].participant_id;

        await db.query(
            `UPDATE activity_participants 
             SET time_in = CURRENT_TIMESTAMP, time_in_at = CURRENT_TIMESTAMP 
             WHERE participant_id = $1`,
            [participant_id]
        );

        return res.json({ success: true, message: `Time-In successfully logged for '${activity.title}'!` });
    } catch (err) {
        console.error('Time-In Error:', err);
        return res.status(500).json({ success: false, message: 'Server error logging Time-In.' });
    }
});

// POST: Time-Out Venue PIN Submission with Early Out Detection & Reason Validation
router.post('/time-out', verifyToken, async (req, res) => {
    const { activity_id, pin, early_out_reason } = req.body;
    const user_id = req.user.user_id;

    if (!pin || !activity_id) {
        return res.status(400).json({ success: false, message: 'Activity ID and 4-digit PIN are required.' });
    }

    try {
        // 1. Fetch Activity & Verification Passcode
        const actResult = await db.query(
            `SELECT activity_id, title, estimated_hours, time_out_passcode 
             FROM programs_activities WHERE activity_id = $1`,
            [activity_id]
        );

        if (actResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Activity not found.' });
        }
        const activity = actResult.rows[0];

        if (activity.time_out_passcode !== pin.trim()) {
            return res.status(400).json({ success: false, message: 'Invalid Time-Out PIN! Please ask the venue coordinator.' });
        }

        // 2. Fetch Participant Record
        const partResult = await db.query(
            `SELECT participant_id, COALESCE(time_in, time_in_at) AS time_in 
             FROM activity_participants WHERE activity_id = $1 AND user_id = $2`,
            [activity_id, user_id]
        );

        if (partResult.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'You have not joined this activity.' });
        }
        const participant = partResult.rows[0];

        if (!participant.time_in) {
            return res.status(400).json({ success: false, message: 'You must Time-In first before logging Time-Out.' });
        }

        // 3. Compute Elapsed Service Hours
        const timeInDate = new Date(participant.time_in);
        const timeOutDate = new Date();
        const diffInMs = timeOutDate - timeInDate;
        const hoursRendered = parseFloat((diffInMs / (1000 * 60 * 60)).toFixed(2));
        const targetHours = parseFloat(activity.estimated_hours);

        const targetReached = hoursRendered >= targetHours;

        // 4. Check early out validation requirement
        if (!targetReached && (!early_out_reason || early_out_reason.trim() === '')) {
            return res.status(400).json({ 
                success: false, 
                requires_early_reason: true,
                hours_rendered: hoursRendered,
                target_hours: targetHours,
                message: `Target hours not reached (${hoursRendered} / ${targetHours} hrs). A valid reason is required for Early Time-Out.` 
            });
        }

        // 5. Save Time-Out Log & Eligibility Status
        const isEligibleForCert = targetReached;
        const finalReason = targetReached ? null : early_out_reason.trim();

        await db.query(
            `UPDATE activity_participants 
             SET 
                 time_out = CURRENT_TIMESTAMP,
                 time_out_at = CURRENT_TIMESTAMP,
                 hours_rendered = $1,
                 target_reached = $2,
                 early_out_reason = $3,
                 is_eligible_for_cert = $4
             WHERE participant_id = $5`,
            [hoursRendered, targetReached, finalReason, isEligibleForCert, participant.participant_id]
        );

        const statusMsg = targetReached 
            ? `Target hours completed! (${hoursRendered} hrs rendered)` 
            : `Early Time-Out recorded (${hoursRendered} hrs acquired). Note: Ineligible for certificate due to early departure.`;

        return res.json({
            success: true,
            hours_rendered: hoursRendered,
            target_reached: targetReached,
            is_eligible_for_cert: isEligibleForCert,
            message: `Time-Out successfully recorded! ${statusMsg}`
        });

    } catch (err) {
        console.error('Time-Out Error:', err);
        return res.status(500).json({ success: false, message: 'Server error logging Time-Out.' });
    }
});
const { generateCertificatePDF } = require('../utils/pdfGenerator');

// GET: Download Official Certificate PDF
router.get('/certificate/download/:participant_id', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;
    const { participant_id } = req.params;

    try {
        // Query participant verification and activity details
        const certQuery = `
            SELECT 
                p.participant_id,
                p.certificate_no,
                p.hours_rendered,
                p.target_reached,
                p.is_eligible_for_cert,
                p.certificate_issued,
                u.full_name AS student_name,
                u.course,
                a.title AS activity_title,
                a.location,
                a.target_date,
                a.estimated_hours
            FROM activity_participants p
            JOIN users u ON p.user_id = u.user_id
            JOIN programs_activities a ON p.activity_id = a.activity_id
            WHERE p.participant_id = $1 AND p.user_id = $2
        `;
        const result = await db.query(certQuery, [participant_id, user_id]);

        if (result.rows.length === 0) {
            return res.status(404).send('Certificate record not found.');
        }

        const record = result.rows[0];

        // Check eligibility rules
        if (!record.is_eligible_for_cert || !record.certificate_issued) {
            return res.status(403).send('Certificate is not yet issued or student is ineligible due to incomplete hours/early out.');
        }

        const certData = {
            certNo: record.certificate_no || `CERT-${new Date().getFullYear()}-${record.participant_id.toString().padStart(5, '0')}`,
            studentName: record.student_name,
            course: record.course,
            activityTitle: record.activity_title,
            location: record.location || 'Vinzons, Camarines Norte',
            targetDate: record.target_date ? new Date(record.target_date).toISOString().split('T')[0] : 'N/A',
            hoursRendered: parseFloat(record.hours_rendered || record.estimated_hours || 0),
            issueDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        };

        const pdfBuffer = await generateCertificatePDF(certData);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Certificate_${certData.certNo}.pdf`);
        res.send(pdfBuffer);

    } catch (err) {
        console.error('Certificate Download Error:', err);
        res.status(500).send('Server error generating certificate PDF.');
    }
});

module.exports = router;
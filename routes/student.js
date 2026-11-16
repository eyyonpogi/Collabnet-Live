const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { generateCertificatePDF } = require('../utils/pdfGenerator');

const PIN_SECRET = process.env.JWT_SECRET || 'collabnet_secret_key_2026';

// Helper: Generate a deterministic 4-digit PIN for a 30-second time window
function generateRotatingPin(activityId, type, stepOffset = 0) {
    const timeStep = Math.floor(Date.now() / 30000) + stepOffset;
    const hmac = crypto
        .createHmac('sha256', PIN_SECRET)
        .update(`${activityId}:${type}:${timeStep}`)
        .digest('hex');
    const num = parseInt(hmac.substring(0, 8), 16) % 10000;
    return num.toString().padStart(4, '0');
}

// Helper: Verify 30-second rotating PIN (allows current 30s window or immediate previous 30s window for clock/typing grace)
function verifyRotatingPin(activityId, type, submittedPin) {
    const cleanPin = (submittedPin || '').trim();
    if (!/^\d{4}$/.test(cleanPin)) return false;

    const currentPin = generateRotatingPin(activityId, type, 0);
    const previousPin = generateRotatingPin(activityId, type, -1);
    return cleanPin === currentPin || cleanPin === previousPin;
}

// GET: Fetch Student Dashboard Metrics & Recent Activities
router.get('/dashboard', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;

    try {
        const statsRes = await db.query(
            `SELECT 
                COUNT(*) AS joined_count,
                COALESCE(SUM(hours_rendered), 0) AS total_hours
             FROM activity_participants 
             WHERE user_id = $1`,
            [user_id]
        );
        const stats = statsRes.rows[0];

        const activitiesRes = await db.query(
            `SELECT a.activity_id, a.title, a.target_date, a.description, a.status, a.estimated_hours,
                    (p.participant_id IS NOT NULL) AS is_joined,
                    p.hours_rendered, p.target_reached,
                    COALESCE(p.time_in, p.time_in_at) AS formatted_time_in,
                    COALESCE(p.time_out, p.time_out_at) AS formatted_time_out
             FROM programs_activities a
             LEFT JOIN activity_participants p ON a.activity_id = p.activity_id AND p.user_id = $1
             WHERE a.status IN ('Approved', 'Completed')
             ORDER BY a.activity_id DESC LIMIT 4`,
            [user_id]
        );

        return res.json({
            success: true,
            user_name: req.user.full_name,
            total_hours: parseFloat(stats.total_hours || 0),
            joined_count: parseInt(stats.joined_count || 0, 10),
            activities: activitiesRes.rows
        });
    } catch (err) {
        console.error('Student Dashboard Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to load dashboard statistics.' });
    }
});

// GET: Fetch Student Profile Details, Total Statistics, and Earned Certificates Gallery
router.get('/profile', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;

    try {
        const userRes = await db.query(
            `SELECT user_id, full_name, email, student_id, course, verification_status 
             FROM users WHERE user_id = $1`,
            [user_id]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Student profile not found.' });
        }

        const user = userRes.rows[0];

        const statsRes = await db.query(
            `SELECT 
                COUNT(*) AS joined_count,
                COALESCE(SUM(hours_rendered), 0) AS total_hours
             FROM activity_participants 
             WHERE user_id = $1`,
            [user_id]
        );
        const stats = statsRes.rows[0];

        const certsRes = await db.query(
            `SELECT 
                p.participant_id,
                p.hours_rendered,
                p.certificate_no,
                a.title AS activity_title,
                a.target_date,
                a.location,
                a.estimated_hours
             FROM activity_participants p
             JOIN programs_activities a ON p.activity_id = a.activity_id
             WHERE p.user_id = $1 
               AND (p.target_reached = TRUE OR p.certificate_issued = TRUE OR p.hours_rendered >= a.estimated_hours)
             ORDER BY a.target_date DESC`,
            [user_id]
        );

        const certificates = certsRes.rows.map(cert => ({
            participantId: cert.participant_id,
            certNo: cert.certificate_no || `CERT-2026-${cert.participant_id.toString().padStart(5, '0')}`,
            activityTitle: cert.activity_title,
            targetDate: cert.target_date ? new Date(cert.target_date).toISOString().split('T')[0] : 'N/A',
            hoursRendered: parseFloat(cert.hours_rendered || cert.estimated_hours || 0)
        }));

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
                joinedCount: parseInt(stats.joined_count || 0, 10),
                earnedCertificatesCount: certificates.length
            },
            certificates: certificates
        });
    } catch (err) {
        console.error('Fetch Profile Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to load profile details.' });
    }
});

// GET: Fetch All Approved Extension Activities with Course Policy & Past-Date Checks
router.get('/activities', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;

    try {
        // Fetch student's actual registered course from database
        const studentRes = await db.query('SELECT course FROM users WHERE user_id = $1', [user_id]);
        const user_course = studentRes.rows[0]?.course ? studentRes.rows[0].course.trim() : '';

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
                (SELECT COUNT(*) FROM activity_participants ap WHERE ap.activity_id = a.activity_id)::int AS current_volunteers,
                (p.participant_id IS NOT NULL) AS is_joined,
                CASE 
                    WHEN LOWER(TRIM(COALESCE(a.target_course, 'All Courses'))) = 'all courses' 
                         OR LOWER(TRIM(COALESCE(a.target_course, ''))) = LOWER($2) THEN true 
                    ELSE false 
                END AS is_eligible,
                CASE 
                    WHEN DATE(a.target_date) < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date THEN true 
                    ELSE false 
                END AS is_past_date
            FROM programs_activities a
            LEFT JOIN activity_participants p ON a.activity_id = p.activity_id AND p.user_id = $1
            WHERE a.status = 'Approved'
            ORDER BY is_past_date ASC, a.target_date ASC, a.activity_id DESC
        `;
        const result = await db.query(query, [user_id, user_course]);

        return res.json({
            success: true,
            student_course: user_course,
            activities: result.rows
        });
    } catch (err) {
        console.error('Fetch Activities Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch activities list.' });
    }
});

// POST: Join or Leave an Extension Activity (Enforces Course Restriction, Backdate Block, and Capacity)
router.post('/activities/join', verifyToken, async (req, res) => {
    const { activity_id, action } = req.body;
    const user_id = req.user.user_id;

    if (!activity_id) {
        return res.status(400).json({ success: false, message: 'Activity ID is required.' });
    }

    try {
        if (action === 'leave') {
            const checkQuery = `
                SELECT 
                    participant_id, 
                    hours_rendered, 
                    target_reached, 
                    certificate_issued,
                    is_eligible_for_cert
                FROM activity_participants
                WHERE activity_id = $1 AND user_id = $2
            `;
            const checkRes = await db.query(checkQuery, [activity_id, user_id]);

            if (checkRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Participation record not found.' });
            }

            const participant = checkRes.rows[0];

            if (participant.certificate_issued || participant.target_reached || participant.is_eligible_for_cert) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Action denied: You cannot leave an activity for which a Certificate of Completion has already been earned or issued.' 
                });
            }

            await db.query(
                `DELETE FROM activity_participants WHERE activity_id = $1 AND user_id = $2`,
                [activity_id, user_id]
            );
            return res.json({ success: true, message: 'Successfully left the activity.' });
        }

        // --- JOIN ACTIVITY LOGIC ---
        // 1. Fetch Student Course
        const studentRes = await db.query(
            `SELECT course, is_verified FROM users WHERE user_id = $1`,
            [user_id]
        );
        if (studentRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Student account not found.' });
        }
        const studentCourse = (studentRes.rows[0].course || '').trim();

        // 2. Fetch Activity Details & Check Past-Date Status in DB
        const targetActRes = await db.query(
            `SELECT activity_id, title, target_date, target_course, max_volunteers, status,
                    (DATE(target_date) < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date) AS is_past_date,
                    (SELECT COUNT(*) FROM activity_participants WHERE activity_id = $1)::int AS current_volunteers
             FROM programs_activities 
             WHERE activity_id = $1`,
            [activity_id]
        );
        if (targetActRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Activity not found.' });
        }
        const targetAct = targetActRes.rows[0];

        if (targetAct.status !== 'Approved') {
            return res.status(400).json({
                success: false,
                message: 'This activity is not currently open for student registration.'
            });
        }

        // 3. Enforce Backdating Prevention (Cannot join past/completed dates)
        if (targetAct.is_past_date) {
            const pastStr = new Date(targetAct.target_date).toISOString().split('T')[0];
            return res.status(400).json({
                success: false,
                message: `Registration Closed: '${targetAct.title}' was scheduled on ${pastStr} and can no longer be joined.`
            });
        }

        // 4. Enforce Restricted Course Policy
        const requiredCourse = (targetAct.target_course || 'All Courses').trim();
        if (
            requiredCourse.toLowerCase() !== 'all courses' &&
            requiredCourse.toLowerCase() !== studentCourse.toLowerCase()
        ) {
            return res.status(403).json({
                success: false,
                message: `Course Restricted: This activity is strictly for ${requiredCourse} students. Your registered program is ${studentCourse || 'Unassigned'}.`
            });
        }

        // 5. Enforce Max Volunteer Capacity
        if (targetAct.max_volunteers && targetAct.current_volunteers >= targetAct.max_volunteers) {
            return res.status(400).json({
                success: false,
                message: `Activity Full: Maximum capacity of ${targetAct.max_volunteers} volunteers has already been reached.`
            });
        }

        // 6. Enforce Same-Day Schedule Conflict Check
        const targetDate = new Date(targetAct.target_date).toISOString().split('T')[0];
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

// POST: Time-In Venue PIN Submission (Validates 30-Second Rotating PIN)
router.post('/time-in', verifyToken, async (req, res) => {
    const { activity_id, pin } = req.body;
    const user_id = req.user.user_id;

    if (!pin || !activity_id) {
        return res.status(400).json({ success: false, message: 'Activity ID and 4-digit PIN are required.' });
    }

    try {
        const actResult = await db.query(
            `SELECT activity_id, title, status FROM programs_activities WHERE activity_id = $1`,
            [activity_id]
        );

        if (actResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Activity not found.' });
        }
        const activity = actResult.rows[0];

        if (!verifyRotatingPin(activity.activity_id, 'IN', pin)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid or expired Time-In PIN! PINs refresh every 30 seconds—check the coordinator screen.' 
            });
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

// POST: Time-Out Venue PIN Submission (Validates 30-Second Rotating PIN + Early Out Detection)
router.post('/time-out', verifyToken, async (req, res) => {
    const { activity_id, pin, early_out_reason } = req.body;
    const user_id = req.user.user_id;

    if (!pin || !activity_id) {
        return res.status(400).json({ success: false, message: 'Activity ID and 4-digit PIN are required.' });
    }

    try {
        const actResult = await db.query(
            `SELECT activity_id, title, estimated_hours 
             FROM programs_activities WHERE activity_id = $1`,
            [activity_id]
        );

        if (actResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Activity not found.' });
        }
        const activity = actResult.rows[0];

        if (!verifyRotatingPin(activity.activity_id, 'OUT', pin)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid or expired Time-Out PIN! PINs refresh every 30 seconds—check the coordinator screen.' 
            });
        }

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

        const timeInDate = new Date(participant.time_in);
        const timeOutDate = new Date();
        const diffInMs = timeOutDate - timeInDate;
        const hoursRendered = parseFloat((diffInMs / (1000 * 60 * 60)).toFixed(2));
        const targetHours = parseFloat(activity.estimated_hours);

        const targetReached = hoursRendered >= targetHours;

        if (!targetReached && (!early_out_reason || early_out_reason.trim() === '')) {
            return res.status(400).json({ 
                success: false, 
                requires_early_reason: true,
                hours_rendered: hoursRendered,
                target_hours: targetHours,
                message: `Target hours not reached (${hoursRendered} / ${targetHours} hrs). A valid reason is required for Early Time-Out.` 
            });
        }

        const finalReason = targetReached ? null : early_out_reason.trim();

        await db.query(
            `UPDATE activity_participants 
             SET 
                 time_out = CURRENT_TIMESTAMP,
                 time_out_at = CURRENT_TIMESTAMP,
                 hours_rendered = $1,
                 target_reached = $2,
                 early_out_reason = $3
             WHERE participant_id = $4`,
            [hoursRendered, targetReached, finalReason, participant.participant_id]
        );

        const statusMsg = targetReached 
            ? `Target hours completed! (${hoursRendered} hrs rendered)` 
            : `Early Time-Out recorded (${hoursRendered} hrs acquired). Note: Ineligible for certificate due to early departure.`;

        return res.json({
            success: true,
            hours_rendered: hoursRendered,
            target_reached: targetReached,
            message: `Time-Out successfully recorded! ${statusMsg}`
        });

    } catch (err) {
        console.error('Time-Out Error:', err);
        return res.status(500).json({ success: false, message: 'Server error logging Time-Out.' });
    }
});

// GET: Download Official Certificate PDF & Persist Certificate Number
router.get('/certificate/download/:participant_id', verifyToken, async (req, res) => {
    const user_id = req.user.user_id;
    const { participant_id } = req.params;

    try {
        const certQuery = `
            SELECT 
                p.participant_id,
                p.certificate_no,
                p.hours_rendered,
                p.target_reached,
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

        let certNo = record.certificate_no;
        if (!certNo) {
            certNo = `CERT-2026-${record.participant_id.toString().padStart(5, '0')}`;
            
            await db.query(
                `UPDATE activity_participants 
                 SET certificate_no = $1, certificate_issued = TRUE 
                 WHERE participant_id = $2`,
                [certNo, participant_id]
            );
        }

        const certData = {
            certNo: certNo,
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
        res.setHeader('Content-Disposition', `inline; filename=Certificate_${certData.certNo}.pdf`);
        res.send(pdfBuffer);

    } catch (err) {
        console.error('Certificate Download Error Details:', err);
        res.status(500).send(`Server error generating certificate PDF: ${err.message}`);
    }
});

module.exports = router;
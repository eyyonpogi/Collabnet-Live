const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Protect all routes in this module for authenticated users
router.use(requireAuth);

// --- 1. LIST ALL PARTNERSHIP MOAs WITH URGENT EXPIRATION METADATA ---
router.get('/', async (req, res) => {
  try {
    // Auto-expire past MOAs
    await pool.query(
      "UPDATE partnerships SET status = 'Expired' WHERE end_date < CURRENT_DATE AND status != 'Expired'"
    );

    const moaQuery = `
      SELECT p.partnership_id, p.moa_title, p.scope_area, a.agency_name, a.agency_type, 
             p.start_date, p.end_date, p.status, p.ollcf_signatory, p.partner_signatory,
             (p.end_date::date - CURRENT_DATE) AS days_remaining
      FROM partnerships p
      JOIN agencies a ON p.agency_id = a.agency_id
      ORDER BY 
        CASE 
          WHEN p.end_date::date < CURRENT_DATE THEN 1
          WHEN (p.end_date::date - CURRENT_DATE) <= 30 THEN 2
          ELSE 3
        END ASC,
        p.end_date ASC
    `;
    const { rows } = await pool.query(moaQuery);

    const enriched = rows.map(row => {
      const daysRemaining = parseInt(row.days_remaining, 10);
      let urgency_level = 'active';
      if (daysRemaining < 0 || row.status === 'Expired') {
        urgency_level = 'expired';
      } else if (daysRemaining <= 7) {
        urgency_level = 'critical';
      } else if (daysRemaining <= 30) {
        urgency_level = 'warning';
      }

      return {
        ...row,
        days_remaining: daysRemaining,
        urgency_level
      };
    });

    const urgentAlerts = enriched.filter(m => ['expired', 'critical', 'warning'].includes(m.urgency_level));

    res.json({
      success: true,
      partnerships: enriched,
      urgentAlerts,
      summary: {
        expiredCount: enriched.filter(m => m.urgency_level === 'expired').length,
        expiringSoonCount: enriched.filter(m => ['critical', 'warning'].includes(m.urgency_level)).length,
        activeCount: enriched.filter(m => m.status === 'Active').length
      }
    });
  } catch (err) {
    console.error('Fetch Partnerships Error:', err);
    res.status(500).json({ error: 'Failed to retrieve partnership agreements.' });
  }
});

// --- 2. REGISTER NEW MOA AGREEMENT (OLLCF Admin Only) ---
router.post('/create', requireRole('Admin'), async (req, res) => {
  const {
    agency_id,
    moa_title,
    scope_area,
    start_date,
    end_date,
    ollcf_signatory,
    partner_signatory,
    terms_summary
  } = req.body;

  if (!agency_id || !moa_title || !start_date || !end_date) {
    return res.status(400).json({
      error: 'Partner Agency, MOA Title, Start Date, and Expiration Date are required fields.'
    });
  }

  try {
    const currentDate = new Date().toISOString().split('T')[0];
    const status = end_date < currentDate ? 'Expired' : 'Active';

    const insertQuery = `
      INSERT INTO partnerships 
      (agency_id, moa_title, scope_area, start_date, end_date, status, ollcf_signatory, partner_signatory, terms_summary)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING partnership_id
    `;
    const values = [
      parseInt(agency_id, 10),
      moa_title.trim(),
      scope_area ? scope_area.trim() : 'IT & Digital Literacy',
      start_date,
      end_date,
      status,
      ollcf_signatory ? ollcf_signatory.trim() : '',
      partner_signatory ? partner_signatory.trim() : '',
      terms_summary ? terms_summary.trim() : ''
    ];

    const newMoa = await pool.query(insertQuery, values);

    const userId = req.user?.user_id || req.session?.user_id || null;
    if (userId) {
      await pool.query(
        'INSERT INTO activity_logs (user_id, action_taken) VALUES ($1, $2)',
        [userId, `Registered New Active MOA: ${moa_title.trim()}`]
      );
    }

    res.json({
      success: true,
      message: 'Partnership MOA registered successfully!',
      partnership_id: newMoa.rows[0].partnership_id
    });
  } catch (err) {
    console.error('Create MOA Error:', err);
    res.status(500).json({ error: 'Failed to register partnership agreement.' });
  }
});

// --- 3. RENEW / EXTEND MOA EXPIRATION DATE (OLLCF Admin Only) ---
router.put('/:partnershipId/renew', requireRole('Admin'), async (req, res) => {
  const partnershipId = parseInt(req.params.partnershipId, 10);
  const { new_end_date } = req.body;

  if (!partnershipId || !new_end_date) {
    return res.status(400).json({ error: 'Partnership ID and new expiration date are required.' });
  }

  try {
    const existing = await pool.query(
      'SELECT partnership_id, moa_title, end_date FROM partnerships WHERE partnership_id = $1',
      [partnershipId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Partnership MOA not found.' });
    }

    const currentDate = new Date().toISOString().split('T')[0];
    const newStatus = new_end_date < currentDate ? 'Expired' : 'Active';

    await pool.query(
      'UPDATE partnerships SET end_date = $1, status = $2 WHERE partnership_id = $3',
      [new_end_date, newStatus, partnershipId]
    );

    const userId = req.user?.user_id || req.session?.user_id || null;
    if (userId) {
      await pool.query(
        'INSERT INTO activity_logs (user_id, action_taken) VALUES ($1, $2)',
        [userId, `Renewed MOA '${existing.rows[0].moa_title}' until ${new_end_date}`]
      );
    }

    res.json({
      success: true,
      message: `MOA '${existing.rows[0].moa_title}' renewed through ${new_end_date}.`
    });
  } catch (err) {
    console.error('Renew MOA Error:', err);
    res.status(500).json({ error: 'Failed to renew MOA agreement.' });
  }
});

// --- 4. PARTNER AGENCIES DIRECTORY ---
router.get('/agencies', async (req, res) => {
  try {
    const query = 'SELECT agency_id, agency_name, agency_type, contact_person, contact_email FROM agencies ORDER BY agency_name ASC';
    const { rows } = await pool.query(query);

    res.json({ success: true, agencies: rows });
  } catch (err) {
    console.error('Fetch Agencies Error:', err);
    res.status(500).json({ error: 'Failed to fetch partner agency directory.' });
  }
});

module.exports = router;
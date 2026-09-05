const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Protect all routes in this module for authenticated users
router.use(requireAuth);

// --- 1. LIST ALL PARTNERSHIP MOAs ---
router.get('/', async (req, res) => {
  try {
    // Auto-expire past MOAs
    await pool.query(
      "UPDATE partnerships SET status = 'Expired' WHERE end_date < CURRENT_DATE AND status != 'Expired'"
    );

    // Fetch MOA records joined with Agency details
    const moaQuery = `
      SELECT p.partnership_id, p.moa_title, p.scope_area, a.agency_name, a.agency_type, 
             p.start_date, p.end_date, p.status, p.ollcf_signatory, p.partner_signatory
      FROM partnerships p
      JOIN agencies a ON p.agency_id = a.agency_id
      ORDER BY p.partnership_id DESC
    `;
    const { rows } = await pool.query(moaQuery);

    res.json({ success: true, partnerships: rows });
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
    // Determine initial status based on validity dates
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

    // Audit Trail Log
    const logMsg = `Registered New Active MOA: ${moa_title.trim()}`;
    await pool.query(
      'INSERT INTO activity_logs (user_id, action_taken) VALUES ($1, $2)',
      [req.session.user_id, logMsg]
    );

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

// --- 3. PARTNER AGENCIES DIRECTORY ---
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
// --- CREATE NEW MOA AGREEMENT (Admin Only) ---
router.post('/create', async (req, res) => {
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
    return res.status(400).json({ error: 'Partner Agency, MOA Title, Start Date, and Expiration Date are required.' });
  }

  try {
    // Automatically set initial status based on end_date
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
      scope_area ? scope_area.trim() : null,
      start_date,
      end_date,
      status,
      ollcf_signatory ? ollcf_signatory.trim() : null,
      partner_signatory ? partner_signatory.trim() : null,
      terms_summary ? terms_summary.trim() : null
    ];

    const result = await pool.query(insertQuery, values);

    // Audit log entry
    if (req.session.user_id) {
      await pool.query(
        'INSERT INTO activity_logs (user_id, action_taken) VALUES ($1, $2)',
        [req.session.user_id, `Registered New Active MOA: ${moa_title.trim()}`]
      );
    }

    res.json({
      success: true,
      message: 'Partnership MOA registered successfully!',
      partnership_id: result.rows[0].partnership_id
    });
  } catch (err) {
    console.error('Create MOA Error:', err);
    res.status(500).json({ error: 'Failed to register partnership agreement.' });
  }
});

module.exports = router;
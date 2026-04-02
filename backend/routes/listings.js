const express = require('express');
const router = express.Router();
const pool = require('../database/db');

/**
 * GET /api/listings
 * Public endpoint — returns all vacant houses with their plot info.
 * No authentication required (used by the public-facing rental portal).
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         h.id,
         h.unit_number,
         h.house_type,
         h.rent_amount,
         h.deposit,
         h.status,
         p.name        AS plot_name,
         p.location    AS plot_location,
         p.gps_lat,
         p.gps_lng,
         p.description AS plot_description
       FROM houses h
       JOIN plots p ON h.plot_id = p.id
       WHERE h.status = 'vacant'
       ORDER BY p.name, h.unit_number`
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching listings:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/listings/:id
 * Public endpoint — returns details for a single vacant house
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         h.id,
         h.unit_number,
         h.house_type,
         h.rent_amount,
         h.deposit,
         h.status,
         h.meter_no,
         p.name        AS plot_name,
         p.location    AS plot_location,
         p.gps_lat,
         p.gps_lng,
         p.description AS plot_description
       FROM houses h
       JOIN plots p ON h.plot_id = p.id
       WHERE h.id = $1 AND h.status = 'vacant'`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Listing not found or no longer available.' });
    }

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching listing:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;

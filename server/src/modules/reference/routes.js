/* Reference data of the user's organization: campuses, buildings, categories, drop-off points. */
const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

router.get('/reference', requireAuth, async (req, res) => {
  const org = req.user.organization_id;
  const [campuses, buildings, categories, dropoffs] = await Promise.all([
    query('SELECT campus_id AS id, name, latitude, longitude FROM campuses WHERE organization_id = $1 ORDER BY name', [org]),
    query(
      `SELECT location_id AS id, campus_id AS "campusId", building AS name, latitude, longitude
         FROM locations WHERE organization_id = $1 ORDER BY building`,
      [org],
    ),
    query(
      `SELECT category_id AS id, name, is_sensitive_default AS sensitive
         FROM categories WHERE organization_id = $1 ORDER BY name = 'Other', name`,
      [org],
    ),
    query(
      `SELECT d.dropoff_id AS id, d.name, d.opening_hours AS "openingHours", d.contact_number AS "contactNumber",
              l.location_id AS "locationId", l.building, l.campus_id AS "campusId"
         FROM dropoff_points d JOIN locations l USING (location_id)
        WHERE d.organization_id = $1 AND d.is_active ORDER BY d.name`,
      [org],
    ),
  ]);
  res.json({
    campuses: campuses.rows.map((c) => ({ ...c, latitude: Number(c.latitude), longitude: Number(c.longitude) })),
    buildings: buildings.rows.map((b) => ({ ...b, latitude: Number(b.latitude), longitude: Number(b.longitude) })),
    categories: categories.rows,
    dropoffs: dropoffs.rows,
  });
});

module.exports = router;

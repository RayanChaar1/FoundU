/* Administration API (FR-16).  Every route is for organization administrators only (Table 10, HTTP 403 otherwise). */
const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { requireRole } = require('../../middleware/auth');

const router = express.Router();
const admin = requireRole('admin');
const id = z.coerce.number().int().positive();
const text = (max, message) => z.string({ error: message }).trim().min(1, message).max(max, `At most ${max} characters.`);
const coordinate = (max, label) => z.coerce.number({ error: `Enter the ${label}.` })
  .min(-max, `The ${label} is between -${max} and ${max}.`).max(max, `The ${label} is between -${max} and ${max}.`);
const hhmm = (message) => z.string({ error: message }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, message);
const day = (message) => z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, message)
  .refine((s) => !Number.isNaN(new Date(s).getTime()), message);

const categorySchema = z.object({ name: text(60, 'Enter the name of the category.'), sensitive: z.boolean().default(false) });
const place = { latitude: coordinate(90, 'latitude'), longitude: coordinate(180, 'longitude') };
const campusSchema = z.object({ name: text(60, 'Enter the name of the campus.'), ...place });
const buildingSchema = z.object({ campusId: id, name: text(80, 'Enter the name of the building.'), ...place });
const dropoffSchema = z.object({
  name: text(80, 'Enter the name of the point.'),
  locationId: id,
  opensAt: hhmm('Enter the opening time.'),
  closesAt: hhmm('Enter the closing time.'),
  contactNumber: text(40, 'Enter a contact number.').regex(/^[0-9+()\-. a-z]+$/i, 'Enter a valid contact number.'),
}).refine((v) => v.closesAt > v.opensAt, { path: ['closesAt'], message: 'The closing time is after the opening time.' });
const points = (min, max) => z.number({ error: `Enter a number from ${min} to ${max}.` }).int(`Enter a whole number.`)
  .min(min, `Enter a number from ${min} to ${max}.`).max(max, `Enter a number from ${min} to ${max}.`);
const settingsSchema = z.object({
  retentionMonths: z.number({ error: 'Enter the retention period.' }).int('Enter a whole number of months.')
    .min(1, 'The retention period is between 1 and 60 months.').max(60, 'The retention period is between 1 and 60 months.'),
  karmaRules: z.object({
    RETURN: points(1, 100), DROPOFF: points(1, 100), HELPFUL_REPORT: points(1, 100), FRAUD: points(-100, -1),
  }),
});

// FR-16.1 to FR-16.5: users
router.get('/users', admin, async (req, res) => {
  res.json({ users: await service.searchUsers(req.user, z.string().max(100).catch('').parse(req.query.q)) });
});
router.get('/users/:id/activity', admin, async (req, res) => {
  res.json(await service.activity(req.user, id.parse(req.params.id)));
});
router.patch('/users/:id/role', admin, async (req, res) => {
  const { role } = z.object({ role: z.string({ error: 'Choose a role.' }) }).parse(req.body);
  res.json({ user: await service.setRole(req.user, id.parse(req.params.id), role) });
});
router.post('/users/:id/suspend', admin, async (req, res) => {
  const { reason } = z.object({ reason: text(500, 'Give the reason for the suspension.') }).parse(req.body);
  res.json({ user: await service.suspend(req.user, id.parse(req.params.id), reason) });
});
router.post('/users/:id/reinstate', admin, async (req, res) => {
  res.json({ user: await service.reinstate(req.user, id.parse(req.params.id)) });
});

// FR-16.6: categories, campuses, buildings
router.get('/admin/places', admin, async (req, res) => res.json(await service.places(req.user)));
router.post('/categories', admin, async (req, res) => {
  res.status(201).json(await service.createCategory(req.user, categorySchema.parse(req.body)));
});
router.patch('/categories/:id', admin, async (req, res) => {
  await service.updateCategory(req.user, id.parse(req.params.id), categorySchema.parse(req.body));
  res.status(204).end();
});
router.delete('/categories/:id', admin, async (req, res) => {
  await service.deleteCategory(req.user, id.parse(req.params.id));
  res.status(204).end();
});
router.post('/campuses', admin, async (req, res) => {
  res.status(201).json(await service.createCampus(req.user, campusSchema.parse(req.body)));
});
router.patch('/campuses/:id', admin, async (req, res) => {
  await service.updateCampus(req.user, id.parse(req.params.id), campusSchema.parse(req.body));
  res.status(204).end();
});
router.delete('/campuses/:id', admin, async (req, res) => {
  await service.deleteCampus(req.user, id.parse(req.params.id));
  res.status(204).end();
});
router.post('/buildings', admin, async (req, res) => {
  res.status(201).json(await service.createBuilding(req.user, buildingSchema.parse(req.body)));
});
router.patch('/buildings/:id', admin, async (req, res) => {
  await service.updateBuilding(req.user, id.parse(req.params.id), buildingSchema.parse(req.body));
  res.status(204).end();
});
router.delete('/buildings/:id', admin, async (req, res) => {
  await service.deleteBuilding(req.user, id.parse(req.params.id));
  res.status(204).end();
});

// FR-16.7: drop-off points (the list and adding a point are FR-14: GET and POST /api/dropoffs)
router.patch('/dropoffs/:id', admin, async (req, res) => {
  await service.updateDropoff(req.user, id.parse(req.params.id), dropoffSchema.parse(req.body));
  res.status(204).end();
});
router.delete('/dropoffs/:id', admin, async (req, res) => {
  await service.removeDropoff(req.user, id.parse(req.params.id));
  res.status(204).end();
});

// FR-16.8: parameters
router.get('/admin/settings', admin, async (req, res) => res.json(await service.settings(req.user)));
router.put('/admin/settings', admin, async (req, res) => {
  res.json(await service.updateSettings(req.user, settingsSchema.parse(req.body)));
});

// FR-16.9: CSV report of the posts and their returns
router.get('/admin/report.csv', admin, async (req, res) => {
  const { from, to } = z.object({ from: day('Choose the start date.'), to: day('Choose the end date.') }).parse(req.query);
  const { csv, filename } = await service.report(req.user, from, to);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

module.exports = router;

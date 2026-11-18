// NFR-3 (burst): 200 posts published within one minute through the API, each starting a Smart Match job.
// Run it together with `perf/load.js 200 60` to see that pages still answer within 2 seconds.
const { sessions, stats, BASE } = require('./common');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { cookies } = await sessions();
  const ref = await fetch(`${BASE}/api/reference`, { headers: { cookie: cookies[0] } }).then((r) => r.json());
  const campus = ref.campuses.find((c) => c.name === 'Beirut');
  const building = ref.buildings.find((b) => b.campusId === campus.id);
  const category = ref.categories.reduce((a, b) => (a.id < b.id ? a : b)); // the category the worst-case data uses
  const times = [];
  const statuses = {};
  const jobs = [];
  for (let i = 0; i < 200; i += 1) {
    const form = new FormData();
    for (const [k, v] of Object.entries({ title: `Lost black wallet burst ${i}`, categoryId: category.id, locationId: building.id, date: new Date().toISOString().slice(0, 10) })) form.append(k, String(v));
    jobs.push((async () => {
      const t = performance.now();
      const res = await fetch(`${BASE}/api/posts/lost`, { method: 'POST', body: form, headers: { cookie: cookies[(i * 7) % cookies.length] } });
      times.push(performance.now() - t);
      statuses[res.status] = (statuses[res.status] || 0) + 1;
    })());
    await sleep(300); // 200 posts in 60 seconds
  }
  await Promise.all(jobs);
  console.log(JSON.stringify({ posts: 200, statuses, publishMs: stats(times) }, null, 1));
})();

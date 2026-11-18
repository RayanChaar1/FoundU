// NFR-1: 200 virtual users browse the feed, search, post pages and the map for a set time; p95 must stay within 2 s
const { sessions, timed, stats } = require('./common');
const USERS = Number(process.argv[2] || 200);
const SECONDS = Number(process.argv[3] || 60);
const WORDS = ['wallet', 'black iphone', 'keys', 'blue bottle', 'laptop', 'airpods', 'id card', 'umbrella', 'jacket', 'charger'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { cookies, beirut, posts } = await sessions();
  const byPage = { feed: [], search: [], detail: [], map: [], header: [] };
  let errors = 0;
  const failed = {};
  let total = 0;
  const end = Date.now() + SECONDS * 1000;
  const minute = [];
  const user = async (i) => {
    const cookie = cookies[i % cookies.length];
    await sleep(Math.random() * 2000); // users arrive over two seconds
    while (Date.now() < end) {
      const r = Math.random();
      const [page, path] = r < 0.3 ? ['feed', `/api/posts?page=${1 + Math.floor(Math.random() * 5)}`]
        : r < 0.55 ? ['search', `/api/posts?q=${encodeURIComponent(WORDS[Math.floor(Math.random() * WORDS.length)])}`]
          : r < 0.8 ? ['detail', `/api/posts/${posts[Math.floor(Math.random() * posts.length)]}`]
            : r < 0.9 ? ['map', `/api/campuses/${beirut}/map`]
              : ['header', '/api/notifications/unread'];
      const res = await timed(path, cookie);
      total += 1;
      if (res.status !== 200) { errors += 1; const k = `${res.status} ${page}`; failed[k] = (failed[k] || 0) + 1; }
      byPage[page].push(res.ms);
      minute.push(res.ms);
      await sleep(1000 + Math.random() * 1000); // reading time between pages
    }
  };
  const tick = setInterval(() => {
    console.log(`${new Date().toISOString().slice(11, 19)} ${minute.length} requests in the last minute, p95 ${stats(minute).p95} ms, errors so far ${errors}`);
    minute.length = 0;
  }, 60000);
  await Promise.all(Array.from({ length: USERS }, (_, i) => user(i)));
  clearInterval(tick);
  const all = Object.values(byPage).flat();
  const out = { users: USERS, seconds: SECONDS, requests: total, perSecond: +(total / SECONDS).toFixed(1), errorRate: +((100 * errors) / total).toFixed(2), failed, all: stats(all) };
  for (const [k, v] of Object.entries(byPage)) out[k] = stats(v);
  console.log(JSON.stringify(out, null, 1));
})();

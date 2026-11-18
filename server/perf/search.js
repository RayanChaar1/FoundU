// NFR-2: 500 varied searches on 50,000 posts, plus heavy queries; each must answer within 2 seconds
const { sessions, timed, stats } = require('./common');
const WORDS = ['iphone','wallet','bottle','backpack','umbrella','laptop','airpods','keys','card','calculator','notebook','jacket',
  'scarf','sunglasses','charger','headphones','watch','bracelet','hoodie','textbook','glasses','camera','ring','lanyard',
  'black','blue','red','silver','sticker','cracked','leather','initials','printer','cafeteria','library','elevator'];
(async () => {
  const { cookies } = await sessions();
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const queries = [];
  for (let i = 0; i < 500; i += 1) {
    const k = i % 3; // single word, two words, three words
    queries.push(k === 0 ? pick() : k === 1 ? `${pick()} ${pick()}` : `${pick()} ${pick()} ${pick()}`);
  }
  const results = [];
  let empty = 0;
  for (const [i, q] of queries.entries()) {
    const r = await timed(`/api/posts?q=${encodeURIComponent(q)}`, cookies[i % cookies.length]);
    if (r.status !== 200) throw new Error(`${q} -> ${r.status}`);
    results.push(r.ms);
  }
  // Correctness: a single-word search returns only posts that contain the word
  const check = await fetch(`${require('./common').BASE}/api/posts?q=umbrella`, { headers: { cookie: cookies[0] } }).then((r) => r.json());
  const correct = check.items.every((p) => /umbrella/i.test(p.title)) && check.total > 0;
  const heavy = {};
  const long = 'black leather wallet with initials inside found near the entrance of the library '.repeat(3).slice(0, 200);
  for (const [name, q] of [['"the"', 'the'], ['"a"', 'a'], ['200 characters', long], ['"%"', '%'], ['common word "black"', 'black']]) {
    const r = await timed(`/api/posts?q=${encodeURIComponent(q)}`, cookies[1]);
    heavy[name] = { ms: +r.ms.toFixed(1), status: r.status };
  }
  const page = await timed('/api/posts?page=500', cookies[2]); // a deep page of the feed
  console.log(JSON.stringify({ searches: stats(results), over2s: results.filter((x) => x > 2000).length, correct, heavy, deepPage: +page.ms.toFixed(1) }, null, 1));
})();

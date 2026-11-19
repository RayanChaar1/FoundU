-- Performance data (NFR-1 to NFR-3): 200 extra users and 50,000 posts at LAU, 10,000 of them OPEN on the Beirut campus.
-- Run with `npm run perf:seed --workspace server` on an empty, seeded database (never the real one).
DO $$
DECLARE lau int; beirut int;
BEGIN
  SELECT organization_id INTO lau FROM organizations WHERE name = 'Lebanese American University';
  SELECT campus_id INTO beirut FROM campuses WHERE organization_id = lau AND name = 'Beirut';
  INSERT INTO users (organization_id, email, full_name, display_name, campus_id)
  SELECT lau, 'perf' || i || '@lau.edu', 'Perf User ' || i, 'Perf ' || i, beirut FROM generate_series(1, 200) i;
END $$;

CREATE TEMP TABLE w AS SELECT
  ARRAY['black','white','blue','red','green','grey','silver','brown','pink','yellow','navy','gold'] AS colour,
  ARRAY['iPhone 13','Samsung phone','wallet','water bottle','backpack','umbrella','laptop','AirPods','keys','ID card',
        'calculator','notebook','jacket','scarf','sunglasses','charger','headphones','watch','bracelet','hoodie',
        'textbook','pencil case','USB drive','glasses','mug','tablet','camera','ring','hat','lanyard'] AS item,
  ARRAY['near the entrance','in room 302','on a bench','under a table','next to the printer','in the cafeteria',
        'by the elevator','in the parking lot','at the library desk','on the stairs'] AS place,
  ARRAY['with a sticker','with a scratch on the back','in a leather case','with initials inside','with a keychain',
        'almost new','with a cracked screen','with a name tag','with a blue strap','with stickers of bands'] AS detail;

WITH lau AS (SELECT organization_id AS id FROM organizations WHERE name = 'Lebanese American University'),
     owners AS (SELECT array_agg(user_id) AS ids FROM users WHERE email LIKE 'perf%@lau.edu'),
     cats AS (SELECT array_agg(category_id ORDER BY category_id) AS ids FROM categories WHERE organization_id = (SELECT id FROM lau)),
     beirut AS (SELECT array_agg(l.location_id) AS ids FROM locations l JOIN campuses c USING (campus_id) WHERE c.name = 'Beirut' AND c.organization_id = (SELECT id FROM lau)),
     byblos AS (SELECT array_agg(l.location_id) AS ids FROM locations l JOIN campuses c USING (campus_id) WHERE c.name = 'Byblos' AND c.organization_id = (SELECT id FROM lau)),
     g AS (SELECT i, random() AS r1, random() AS r2, random() AS r3, random() AS r4, random() AS r5 FROM generate_series(1, 50000) i)
INSERT INTO posts (organization_id, owner_id, type, title, description, category_id, location_id, event_datetime, status,
                   whereabouts, verification_question, verification_answer_enc, created_at, closed_at, returned_at)
SELECT (SELECT id FROM lau),
       owners.ids[1 + (g.r1 * 199)::int],
       t.type,
       initcap(w.colour[1 + (g.r2 * 11)::int]) || ' ' || w.item[1 + (g.r3 * 29)::int],
       'Found or lost ' || w.place[1 + (g.r4 * 9)::int] || ', ' || w.detail[1 + (g.r5 * 9)::int] || '.',
       cats.ids[1 + (g.r3 * (array_length(cats.ids, 1) - 1))::int],
       CASE WHEN g.i <= 10000 OR g.r4 < 0.6 THEN beirut.ids[1 + (g.r5 * (array_length(beirut.ids, 1) - 1))::int]
            ELSE byblos.ids[1 + (g.r5 * (array_length(byblos.ids, 1) - 1))::int] END,
       now() - make_interval(days => (g.r1 * 360)::int),
       s.status,
       CASE WHEN t.type = 'FOUND' THEN 'FINDER' END,
       CASE WHEN t.type = 'FOUND' THEN 'What colour is it?' END,
       CASE WHEN t.type = 'FOUND' THEN '__ANSWER__' END,
       now() - make_interval(days => (g.r1 * 360)::int),
       CASE WHEN s.status = 'CLOSED' THEN now() - make_interval(days => (g.r1 * 30)::int) END,
       CASE WHEN s.status IN ('RETURNED', 'CLOSED') THEN now() - make_interval(days => (g.r1 * 40)::int) END
  FROM g, w, owners, cats, beirut, byblos,
       LATERAL (SELECT CASE WHEN g.r2 < 0.5 THEN 'LOST' ELSE 'FOUND' END AS type) t,
       LATERAL (SELECT CASE WHEN g.i <= 10000 THEN 'OPEN'
                            WHEN g.r4 < 0.6 THEN (ARRAY['CLOSED','CLOSED','RETURNED','CLAIMED'])[1 + (g.r1 * 3)::int]
                            ELSE (ARRAY['OPEN','CLOSED','RETURNED'])[1 + (g.r2 * 2)::int] END AS status) s;
ANALYZE posts;
SELECT status, count(*) FROM posts GROUP BY status ORDER BY 1;
SELECT c.name AS campus, count(*) FILTER (WHERE p.status = 'OPEN') AS open FROM posts p JOIN locations l USING (location_id) JOIN campuses c USING (campus_id) GROUP BY 1;

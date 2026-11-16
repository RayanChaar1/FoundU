/* Smart Match score (FR-5.2), as specified in Table 12 of the Phase I report.  Pure functions, no database. */

const DAY = 24 * 60 * 60 * 1000;

// Common words removed before comparing keywords
const STOP_WORDS = new Set(`a about above after again against all am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he her here
hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once
only or other our ours out over own same she so some such than that the their theirs them then there these they this those
through to too under until up very was we were what when where which while who whom why will with you your yours
found lost item near left today yesterday please someone anyone`.split(/\s+/));

/** Keywords of a text: lower case, accents removed, common words and one-letter words dropped, simple plurals folded. */
function keywords(text = '') {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return new Set(words);
}

/** Keyword similarity S (0 to 1): the share of common keywords among all keywords of both posts (Jaccard). */
function similarity(a, b) {
  const ka = keywords(`${a.title} ${a.description || ''}`);
  const kb = keywords(`${b.title} ${b.description || ''}`);
  if (!ka.size || !kb.size) return 0;
  let common = 0;
  for (const w of ka) if (kb.has(w)) common += 1;
  return common / (ka.size + kb.size - common);
}

/** Calendar days from `a` to `b` (positive when `b` is later), ignoring the time of day. */
function calendarDays(a, b) {
  const day = (d) => {
    const x = new Date(d);
    return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  };
  return Math.round((day(b) - day(a)) / DAY);
}

/**
 * Score of a lost and a found post (0 to 100).  Each post carries category_id, location_id, campus_id,
 * event_datetime, title and description.  Returns 0 when the pair is not compared.
 */
function score(lost, found, w) {
  if (lost.category_id !== found.category_id || lost.campus_id !== found.campus_id) return 0;
  const days = calendarDays(lost.event_datetime, found.event_datetime);
  if (days < -1) return 0; // found more than one day before the loss
  let total = w.category;
  total += lost.location_id === found.location_id ? w.building : w.campus;
  const apart = Math.abs(days);
  if (apart <= 1) total += w.date1;
  else if (apart <= 3) total += w.date3;
  else if (apart <= 7) total += w.date7;
  total += Math.round(w.keywords * similarity(lost, found));
  return Math.min(100, total);
}

/** Highest possible score with the given weights; never above 100 (FR-5.9). */
const maxScore = (w) => w.category + Math.max(w.building, w.campus) + Math.max(w.date1, w.date3, w.date7) + w.keywords;

module.exports = { score, similarity, keywords, calendarDays, maxScore };

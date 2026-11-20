// NFR-19.2: FoundU runs on open-source software only.  Every package installed for production (package-lock.json,
// without development packages) must carry an open-source licence; anything else fails `npm test`.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// OSI-approved licences (and the SIL Open Font License of the bundled fonts)
const OPEN = new Set(['MIT', 'MIT-0', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0', 'BlueOak-1.0.0',
  'CC0-1.0', 'Unlicense', 'Python-2.0', 'Zlib', 'LGPL-2.1', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'OFL-1.1']);

/** The licence of one installed package: the lock file entry, else its package.json, else its LICENSE file. */
function licenceOf(dir, entry) {
  if (entry.license) return entry.license;
  const pkg = path.join(dir, 'package.json');
  if (fs.existsSync(pkg)) {
    const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    if (j.license) return typeof j.license === 'string' ? j.license : j.license.type;
    if (Array.isArray(j.licenses) && j.licenses.length) return j.licenses.map((l) => l.type).join(' OR ');
  }
  const file = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8') : '';
  return /Permission is hereby granted, free of charge/.test(text) ? 'MIT' : 'UNKNOWN'; // the MIT licence text
}

/** True if an SPDX expression is open: every AND part is open, at least one OR alternative is. */
function isOpen(expr) {
  const e = expr.replace(/[()]/g, ' ').trim();
  return e.split(/\s+OR\s+/).some((alt) => alt.split(/\s+AND\s+/).every((id) => OPEN.has(id.trim())));
}

/** Production packages of a lock file whose licence is not open source, as "name licence". */
function closedPackages(lock, root) {
  return Object.entries(lock.packages)
    .filter(([key, p]) => key.includes('node_modules/') && !p.dev && !p.link)
    .map(([key, p]) => [key.slice(key.lastIndexOf('node_modules/') + 13), licenceOf(path.join(root, key), p)])
    .filter(([, lic]) => !isOpen(lic))
    .map(([name, lic]) => `${name} ${lic}`);
}

describe('NFR-19.2 Open-source stack', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

  test('TC-NFR-19.2-V: every production dependency has an open-source licence', () => {
    const production = Object.entries(lock.packages).filter(([k, p]) => k.includes('node_modules/') && !p.dev && !p.link);
    expect(production.length).toBeGreaterThan(100);
    expect(closedPackages(lock, ROOT)).toEqual([]);
  });

  test('TC-NFR-19.2-D: a dependency with a proprietary licence fails the check', () => {
    const seeded = { packages: { ...lock.packages,
      'node_modules/acme-proprietary-sdk': { version: '1.0.0', license: 'SEE LICENSE IN EULA.txt' },
      'node_modules/closed-tool': { version: '2.1.0', license: 'UNLICENSED' },
      'node_modules/dev-only-closed': { version: '1.0.0', license: 'UNLICENSED', dev: true } } };
    expect(closedPackages(seeded, ROOT)).toEqual(['acme-proprietary-sdk SEE LICENSE IN EULA.txt', 'closed-tool UNLICENSED']);
  });
});

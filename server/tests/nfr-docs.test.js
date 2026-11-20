// NFR-15.3: every module of the server documents its purpose, interface and dependencies in a README.md.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULES = path.join(__dirname, '..', 'src', 'modules');
const SECTIONS = ['## Purpose', '## Interface', '## Dependencies'];

/** Names of the module folders of `dir` whose README.md is missing or lacks one of the sections. */
function undocumented(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).filter((name) => {
    const readme = path.join(dir, name, 'README.md');
    if (!fs.existsSync(readme)) return true;
    const text = fs.readFileSync(readme, 'utf8');
    return !SECTIONS.every((s) => text.includes(s));
  });
}

describe('NFR-15.3 Module documentation', () => {
  test('TC-NFR-15.3-V: every module states its purpose, interface and dependencies', () => {
    expect(fs.readdirSync(MODULES).length).toBeGreaterThan(10);
    expect(undocumented(MODULES)).toEqual([]);
  });

  test('TC-NFR-15.3-D: a module folder without a README is detected', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundu-modules-'));
    fs.cpSync(path.join(MODULES, 'posts'), path.join(dir, 'posts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'test-module'));
    fs.writeFileSync(path.join(dir, 'test-module', 'routes.js'), 'module.exports = require("express").Router();\n');
    fs.mkdirSync(path.join(dir, 'half-documented'));
    fs.writeFileSync(path.join(dir, 'half-documented', 'README.md'), '# Half\n\n## Purpose\n\nNo interface section.\n');
    try {
      expect(undocumented(dir).sort()).toEqual(['half-documented', 'test-module']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

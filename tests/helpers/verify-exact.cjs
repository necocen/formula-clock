'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
module.exports = (records) => {
  const venv = path.join(
    root,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const python = process.env.FORMULA_CLOCK_PYTHON || (fs.existsSync(venv) ? venv : 'python3');
  const result = spawnSync(python, [path.join(__dirname, 'verify-exact.py')], {
    input: JSON.stringify(records),
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Exact verification failed. Install Python test dependencies with python -m pip install -r requirements-test.txt.\n${result.error || result.stderr}`,
    );
  const report = JSON.parse(result.stdout);
  if (
    !Array.isArray(report.results) ||
    report.results.length !== records.length ||
    report.results.some((row) => typeof row?.valid !== 'boolean')
  )
    throw new Error('Invalid exact verification report');
  return report;
};

// ==============================================================================
// WISHRITE INVENTORY — AUTOMATED TEST RUNNER (ISOLATED EXECUTION)
// Runs each test suite in clean process isolation with pristine fixtures
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const TESTS_DIR = path.join(ROOT_DIR, 'tests');

// Backup pristine test fixtures before run
const FIXTURES = ['influencers_store.json', 'occasion_settings.json', 'product_meta.json'];
const backups = new Map();

for (const file of FIXTURES) {
    const fullPath = path.join(DATA_DIR, file);
    if (fs.existsSync(fullPath)) {
        backups.set(fullPath, fs.readFileSync(fullPath, 'utf-8'));
    }
}

function restoreFixtures() {
    for (const [fullPath, content] of backups.entries()) {
        try {
            fs.writeFileSync(fullPath, content, 'utf-8');
        } catch (e) {}
    }
}

// Discover all test files in tests/
const testFiles = fs.readdirSync(TESTS_DIR)
    .filter(f => f.endsWith('.test.js'))
    .sort();

console.log(`\n==============================================================================`);
console.log(`WISHRITE TEST RUNNER: Running ${testFiles.length} Test Suites in Clean Isolation`);
console.log(`==============================================================================\n`);

let totalPassed = 0;
let totalFailed = 0;
const failedSuites = [];

const startTime = Date.now();

for (const file of testFiles) {
    restoreFixtures();
    const testPath = path.join(TESTS_DIR, file);
    process.stdout.write(`▶ Running suite: ${file}... `);

    const env = {
        ...process.env,
        NODE_ENV: 'test',
        ALLOW_LIVE_PAYOUTS: 'false',
        RAZORPAYX_MODE: 'sandbox'
    };

    const res = spawnSync('node', ['--test', testPath], {
        cwd: ROOT_DIR,
        env,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
    });

    if (res.status === 0) {
        console.log(`\x1b[32m✔ PASS\x1b[0m`);
        totalPassed++;
    } else {
        console.log(`\x1b[31m✖ FAIL\x1b[0m`);
        totalFailed++;
        failedSuites.push({
            file,
            output: (res.stdout || '') + '\n' + (res.stderr || '')
        });
    }
}

restoreFixtures();

const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`\n==============================================================================`);
console.log(`TEST SUMMARY (${durationSec}s):`);
console.log(`Passed Suites: ${totalPassed}/${testFiles.length}`);
console.log(`Failed Suites: ${totalFailed}/${testFiles.length}`);
console.log(`==============================================================================\n`);

if (totalFailed > 0) {
    console.error(`\x1b[31mDetailed failure logs for ${failedSuites.length} failing suite(s):\x1b[0m\n`);
    for (const f of failedSuites) {
        console.error(`--- [${f.file}] ---`);
        console.error(f.output.trim());
        console.error('\n');
    }
    process.exit(1);
} else {
    console.log(`\x1b[32m✔ ALL ${testFiles.length} TEST SUITES PASSED CLEANLY!\x1b[0m\n`);
    process.exit(0);
}

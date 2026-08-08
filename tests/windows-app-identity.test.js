'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Windows package and runtime use the OrangeSea identity and icon', () => {
  const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const mainSource = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');

  assert.equal(packageInfo.build.appId, 'com.orangesea.desktop');
  assert.equal(packageInfo.mineradio.appUserModelId, 'com.orangesea.desktop');
  assert.equal(packageInfo.mineradio.runtimeName, 'OrangeSea');
  assert.equal(packageInfo.build.win.icon, 'build/icon.ico');
  assert.equal(packageInfo.build.nsis.installerIcon, 'build/icon.ico');
  assert.equal(packageInfo.build.nsis.uninstallerIcon, 'build/icon.ico');
  assert.match(mainSource, /APP_ICON_ICO = path\.join\(__dirname, '\.\.', 'build', 'icon\.ico'\)/);
  assert.match(mainSource, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
  assert.match(mainSource, /'com\.orangesea\.desktop';/);
  assert.doesNotMatch(mainSource, /'com\.mineradio\.desktop';/);
});
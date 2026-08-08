'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.join(
  __dirname,
  '..',
  'public',
  'js',
  'modules',
  '05-playback',
  '19-equalizer.js',
);

function makeNode(context) {
  return {
    context,
    type: '',
    frequency: { value: 0 },
    Q: { value: 0 },
    gain: { value: 0 },
    connections: [],
    connect(target) { this.connections.push(target); },
    disconnect() { this.connections = []; },
  };
}

function makeAudioContext() {
  const context = {
    nodes: [],
    createBiquadFilter() {
      const node = makeNode(context);
      context.nodes.push(node);
      return node;
    },
  };
  return context;
}

const sandbox = {
  console,
  localStorage: {
    getItem() { return null; },
    setItem() {},
  },
  document: {
    getElementById() { return null; },
    querySelectorAll() { return []; },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });

const firstContext = makeAudioContext();
sandbox.ensureEqChain(firstContext);
assert.equal(sandbox.eqNodes.length, 10);
for (let i = 0; i < 9; i += 1) {
  assert.deepEqual(sandbox.eqNodes[i].connections, [sandbox.eqNodes[i + 1]]);
}

const reusedNodes = sandbox.eqNodes.slice();
sandbox.disconnectEqChain();
assert.ok(sandbox.eqNodes.every((node) => node.connections.length === 0));
sandbox.ensureEqChain(firstContext);
assert.equal(sandbox.eqNodes[0], reusedNodes[0], 'same AudioContext should reuse EQ nodes');
for (let i = 0; i < 9; i += 1) {
  assert.deepEqual(sandbox.eqNodes[i].connections, [sandbox.eqNodes[i + 1]], 'EQ chain was not reconnected');
}

const secondContext = makeAudioContext();
sandbox.ensureEqChain(secondContext);
assert.notEqual(sandbox.eqNodes[0], reusedNodes[0], 'new AudioContext must recreate EQ nodes');
assert.ok(sandbox.eqNodes.every((node) => node.context === secondContext));
for (let i = 0; i < 9; i += 1) {
  assert.deepEqual(sandbox.eqNodes[i].connections, [sandbox.eqNodes[i + 1]]);
}

console.log('OK equalizer chain reconnects after audio graph rebuilds');

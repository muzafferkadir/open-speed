import assert from 'node:assert/strict';
import { test } from 'node:test';
import { biomeAt, terrainHeight, waterDepth } from '../src/physics/Terrain.ts';

const land = { coast: { rx: 1000, rz: 1000 }, lake: { x: 5000, z: 5000, rx: 10, rz: 10 }, waterLevel: 0, maxWadeDepth: 0.6 };

test('biomes by region', () => {
 assert.equal(biomeAt(0, -300), 'alpine');
 assert.equal(biomeAt(-400, 0), 'coast');
 assert.equal(biomeAt(0, 300), 'beach');
 assert.equal(biomeAt(300, 200), 'harbor');
 assert.equal(biomeAt(200, 0), 'town');
 assert.equal(biomeAt(0, 0), 'forest');
});

test('inland is dry and above water', () => {
 assert.ok(terrainHeight(land, 0, 0) > 0);
 assert.equal(waterDepth(land, 0, 0), 0);
});

test('offshore is under water', () => {
 assert.ok(waterDepth(land, 2000, 0) > 0);
});

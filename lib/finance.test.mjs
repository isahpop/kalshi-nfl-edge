import test from 'node:test';
import assert from 'node:assert/strict';
import { validPrice, calcEdge, quarterKelly, impliedFromAmerican, noVigTwoWay } from './finance.mjs';
import { matchTeam } from './teams.mjs';

test('invalid market quotes are rejected', () => {assert.equal(validPrice(0), null); assert.equal(validPrice(1), null);assert.equal(validPrice('0.60'), .6)});
test('expected edge at 65% fair and 55c ask is 10 percentage points', () => {const r=calcEdge(.65,.55);assert.ok(Math.abs(r.edge-.10)<1e-9);});
test('quarter Kelly with five percent bankroll cap on $200 is never more than $10', () => {const r=quarterKelly(.9,.4,200);assert.ok(r.stake <= 10); assert.ok(r.contracts >= 0);});
test('negative edge produces zero suggested contracts', () => {assert.equal(quarterKelly(.3,.65).contracts,0);});
test('no-vig probabilities add to one', () => {const result=noVigTwoWay(-120,+105);assert.ok(Math.abs(result[0]+result[1]-1)<1e-9)});
test('American odds conversion handles both signs',()=>{assert.ok(Math.abs(impliedFromAmerican(100)-.5)<1e-9);assert.ok(Math.abs(impliedFromAmerican(-100)-.5)<1e-9)});
test('team matching is exact and conservative',()=>{assert.equal(matchTeam('Cowboys',['Dallas Cowboys','Philadelphia Eagles']),'Dallas Cowboys');assert.equal(matchTeam('New York',['New York Jets','New York Giants']),null)});

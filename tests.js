/**
 * Regression tests for the Little Bean conversation engine.
 * Run with:  node tests.js
 * Covers the proposal's scenarios plus multi-drink orders, multiple extras and spoken confirmation.
 */
const assert = require('node:assert/strict');
const {respond, parseInput, freshState, MENU, FIELDS, DRINK_FIELDS, DETAIL_FIELDS} = require('./app.js');

let passed = 0;
function test(name, fn){ fn(); passed++; }
/** Run a conversation; returns the final state and the last reply. */
function chat(...lines){
  const st = freshState(); let out = {};
  for (const line of lines) out = respond(st, line);
  return {st, out};
}

test('schema', () => {
  assert.equal(MENU.length, 6);
  assert.equal(DRINK_FIELDS.length, 6);
  assert.equal(DETAIL_FIELDS.length, 3);
  assert.equal(FIELDS.length, 9);
});

test('several answers at once (proposal)', () => {
  const {st, out} = chat('Two large iced oat milk lattes');
  assert.deepEqual({...st.current, extras:undefined}, {drink:'Latte',size:'Large',temperature:'Iced',milk:'Oat milk',extras:undefined,quantity:'2'});
  assert.match(out.reply, /extras/i);
});

test('missing information: a latte keeps the drink and asks for size (proposal)', () => {
  const {st, out} = chat('A latte');
  assert.equal(st.current.drink, 'Latte');
  assert.match(out.reply, /size/i);
});

test('invalid answer: coconut milk keeps the rest and asks for milk (proposal)', () => {
  const {st, out} = chat('large coconut milk latte');
  assert.equal(st.current.drink, 'Latte');
  assert.equal(st.current.size, 'Large');
  assert.equal(st.current.milk, null);
  assert.equal(st.pin, 'milk');
  assert.match(out.reply, /coconut milk isn’t on our menu/);
});

test('change of mind: actually make it oat milk (proposal)', () => {
  const {st} = chat('Latte', 'large', 'hot', 'whole milk', 'Actually make it oat milk');
  assert.equal(st.current.milk, 'Oat milk');
  assert.equal(st.current.size, 'Large');
});

test('multiple extras', () => {
  assert.deepEqual(parseInput('vanilla and an extra shot', 'extras').groups[0].extras, ['Vanilla syrup','Extra espresso shot']);
  const {st} = chat('Latte', 'small', 'hot', 'oat', 'Vanilla syrup and Caramel syrup', '1');
  assert.deepEqual(st.items[0].extras, ['Vanilla syrup','Caramel syrup']);
  assert.deepEqual(chat('Latte', 'small', 'hot', 'oat', 'no').st.current.extras, []);
});

test('two drinks in one sentence are both kept', () => {
  const {st, out} = chat('a large hot latte and two small iced mochas');
  assert.equal(st.current.drink, 'Latte');
  assert.equal(st.current.quantity, '1');
  assert.equal(st.queue.length, 1);
  assert.equal(st.queue[0].drink, 'Mocha');
  assert.equal(st.queue[0].quantity, '2');
  assert.match(out.reply, /2 Mochas/);
});

test('queued drink is asked about after the first one', () => {
  const {st, out} = chat('a large hot latte and two small iced mochas', 'oat milk', 'none');
  assert.equal(st.items.length, 1);
  assert.equal(st.current.drink, 'Mocha');
  assert.match(out.reply, /Now for your Mocha/);
  assert.match(out.reply, /milk/i);
});

test('full multi-drink order with spoken confirmation', () => {
  const {st, out} = chat(
    'a large hot latte with oat milk and vanilla', // latte complete except nothing
    'Add another drink',
    'two small iced mochas', 'whole', 'whipped cream',
    'That’s everything',
    'as soon as possible', 'Maya', 'pay at pickup'
  );
  assert.equal(st.items.length, 2);
  assert.equal(st.stage, 'confirm');
  assert.match(out.reply, /Please confirm: 1 large hot latte with oat milk and vanilla syrup, plus 2 small iced mochas with whole milk and whipped cream/);
  assert.match(out.reply, /Is that correct\?/);
  const done = respond(st, 'Yes, place my order');
  assert.equal(done.action, 'complete');
});

test('anything else? answers', () => {
  const base = ['Latte','small','hot','oat','none','1'];
  assert.equal(chat(...base).st.stage, 'more');
  assert.equal(chat(...base, 'no').st.stage, 'details');
  assert.equal(chat(...base, 'yes').st.stage, 'drink');
  const viaDrink = chat(...base, 'a cappuccino').st;
  assert.equal(viaDrink.current.drink, 'Cappuccino');
  assert.equal(viaDrink.items.length, 1);
});

test('confirmation "no" asks what to change; corrections update the right drink', () => {
  const lines = ['a latte, large, hot, oat milk, no extras', 'and a small iced mocha with whole milk and no extras', 'that’s it', 'asap', 'Sam', 'counter'];
  const {st} = chat(...lines);
  assert.equal(st.stage, 'confirm', JSON.stringify(st));
  assert.match(respond(st, 'no').reply, /What would you like to change/);
  const out = respond(st, 'make the latte almond milk');
  assert.equal(st.items.find(d => d.drink === 'Latte').milk, 'Almond milk');
  assert.equal(st.items.find(d => d.drink === 'Mocha').milk, 'Whole milk');
  assert.match(out.reply, /Please confirm/);
});

test('remove a drink by voice/text', () => {
  const {st} = chat('a small hot latte with oat milk and no extras', 'a large iced mocha with whole milk and no extras');
  assert.equal(st.items.length, 2);
  respond(st, 'remove the mocha');
  assert.deepEqual(st.items.map(d => d.drink), ['Latte']);
});

test('remove an extra without adding it', () => {
  const {st} = chat('a small hot latte with oat milk, vanilla and caramel');
  respond(st, 'take off the caramel');
  assert.deepEqual(st.items[0].extras, ['Vanilla syrup']);
});

test('drink words are not accepted as a pickup name', () => {
  const {st} = chat('a small hot latte with oat milk and no extras', 'that’s all', 'asap');
  const before = JSON.stringify(st.items);
  const out = respond(st, 'latte');
  assert.equal(st.details.name, null);
  assert.equal(JSON.stringify(st.items), before);
  assert.match(out.reply, /name/i);
  respond(st, 'my name is Maya');
  assert.equal(st.details.name, 'Maya');
});

test('details given early are remembered and not asked again', () => {
  const {st, out} = chat('a small hot latte with oat milk and no extras, pickup in 15 minutes', 'nope');
  assert.equal(st.details.pickup, 'In 15 minutes');
  assert.match(out.reply, /first name/);
});

test('unclear input gets a helpful retry', () => {
  const {out} = chat('banana bread');
  assert.equal(out.changed, false);
  assert.match(out.reply, /didn’t quite catch that/);
});

test('original parser behaviour still holds', () => {
  const g = s => parseInput(s.toLowerCase(), 'drink').groups[0] || {};
  assert.equal(g('Matcha latte').drink, 'Matcha Latte');
  assert.equal(g('2% milk latte').milk, '2% milk');
  assert.equal(parseInput('in 15 minutes', 'pickup').details.pickup, 'In 15 minutes');
  assert.equal(parseInput('pay at the counter', 'payment').details.payment, 'Pay at counter');
});

console.log(`All ${passed} test groups passed.`);

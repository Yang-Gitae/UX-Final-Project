'use strict';
/**
 * Little Bean — voice/text coffee ordering avatar ("Beanie")
 * SOFE 4850U User Experience Design, Fall 2026 — Group 12 prototype
 * (Connor Boivin, Gitae Yang, Elvis Sikapi)
 *
 * File layout
 *   1. Menu and question data
 *   2. Rule-based text parsing (no AI service)
 *   3. Conversation engine — respond(state, text). Pure logic with no DOM,
 *      so tests.js can run it in Node.
 *   4. Browser UI — rendering, dialogs, Web Speech API (speech-to-text and
 *      text-to-speech)
 *
 * Order model
 *   state.items    drinks that are fully specified (the cart)
 *   state.current  the drink Beanie is asking about right now
 *   state.queue    extra drinks mentioned in one sentence ("a latte and a mocha"),
 *                  waiting their turn
 *   state.details  order-level answers asked once: pickup time, name, payment
 *   state.stage    'drink' → 'more' ("anything else?") → 'details' → 'confirm' → 'done'
 *
 * Everything stays in the page. Nothing is sent to a server and no payment is taken.
 */

/* ------------------------------------------------------------------ */
/* 1. Data                                                             */
/* ------------------------------------------------------------------ */

const MENU = [
  {name:'Latte',price:4.75,sub:'Smooth & perfectly balanced',className:'latte',bg:'#f5e7d9'},
  {name:'Cappuccino',price:4.5,sub:'Foamy, cozy, classic',className:'cappuccino',bg:'#f5e9db'},
  {name:'Americano',price:3.5,sub:'Bold & beautifully simple',className:'espresso',bg:'#f2e8d9'},
  {name:'Mocha',price:5.25,sub:'Chocolate meets coffee',className:'chocolate',bg:'#f4e2d8'},
  {name:'Matcha Latte',price:5.25,sub:'Your green little reset',className:'matcha',bg:'#e4efda'},
  {name:'Chai Latte',price:4.75,sub:'Warm spices, happy vibes',className:'tea',bg:'#f8ebd4'}
];

const EXTRAS = ['Vanilla syrup','Caramel syrup','Extra espresso shot','Whipped cream'];

/** Questions asked once per drink. */
const DRINK_FIELDS = [
  {key:'drink',label:'Drink',choices:MENU.map(x=>x.name),question:'What can I get started for you today? Pick a favourite or tell me your drink.'},
  {key:'size',label:'Size',choices:['Small','Medium','Large'],question:'What size would you like? Small, medium, or large?'},
  {key:'temperature',label:'Temperature',choices:['Hot','Iced'],question:'Would you like it hot or iced?'},
  {key:'milk',label:'Milk',choices:['Whole milk','2% milk','Oat milk','Almond milk','Soy milk','No milk'],question:'Which milk works for you? We have whole, 2%, oat, almond, soy, or no milk.'},
  {key:'extras',label:'Extras',choices:EXTRAS,multi:true,question:'Any extras? You can pick more than one: vanilla, caramel, an extra shot, or whipped cream. Or say none.'},
  {key:'quantity',label:'Quantity',choices:['1','2','3','4'],question:'How many would you like?'}
];

/** Questions asked once per order, after the last drink. */
const DETAIL_FIELDS = [
  {key:'pickup',label:'Pickup time',choices:['As soon as possible','In 10 minutes','In 15 minutes','In 20 minutes'],question:'When would you like to pick up your order?'},
  {key:'name',label:'Pickup name',choices:[],question:'What first name should I put on your order?'},
  {key:'payment',label:'Payment',choices:['Pay at pickup','Pay at counter'],question:'Last thing! Would you like to pay at pickup or at the counter? No payment is taken here.'}
];

const FIELDS = [...DRINK_FIELDS, ...DETAIL_FIELDS];
const PRICES = {
  size:{Small:0,Medium:.4,Large:.8},
  plantMilk:.65,
  extras:{'Vanilla syrup':.5,'Caramel syrup':.5,'Extra espresso shot':1.1,'Whipped cream':.6}
};

/* Small helpers */
const clean = s => String(s ?? '').trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => clean(s).toLowerCase().replace(/[’']/g,'').replace(/[.!?]+/g,' ').replace(/\s+/g,' ').trim();
const money = v => '$' + v.toFixed(2);
const field = k => FIELDS.find(f => f.key === k);
const emptyDrink = () => ({drink:null,size:null,temperature:null,milk:null,extras:null,quantity:null});
const freshState = () => ({items:[],current:emptyDrink(),queue:[],details:{pickup:null,name:null,payment:null},stage:'drink',pin:null,finished:false});
const drinkMissing = d => DRINK_FIELDS.find(f => d[f.key] === null)?.key ?? null;
const detailMissing = st => DETAIL_FIELDS.find(f => st.details[f.key] === null)?.key ?? null;
const plural = (name, q) => Number(q) > 1 ? name + 's' : name;
const article = word => /^[aeiou]/i.test(word) ? 'an' : 'a';
const listText = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0,-1).join(', ') + ' and ' + arr[arr.length-1];
const extrasText = list => !list ? 'Not chosen' : list.length ? listText(list) : 'None';
const lastIndexWhere = (arr, fn) => { for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i; return -1; };

/** Field Beanie is currently asking about, or null when it is asking a yes/no style question. */
function activeField(st){
  if (st.stage === 'drink' && st.current) return (st.pin && st.current[st.pin] === null) ? st.pin : drinkMissing(st.current);
  if (st.stage === 'details') return detailMissing(st);
  return null;
}

/* Pricing (demo values only) */
function itemPrice(d){
  const m = MENU.find(x => x.name === d.drink);
  if (!m) return 0;
  const unit = m.price + (PRICES.size[d.size] || 0)
    + (['Oat milk','Almond milk','Soy milk'].includes(d.milk) ? PRICES.plantMilk : 0)
    + (d.extras || []).reduce((sum, e) => sum + (PRICES.extras[e] || 0), 0);
  return unit * (Number(d.quantity) || 1);
}
const orderTotal = st => st.items.reduce((sum, d) => sum + itemPrice(d), 0) + (st.stage === 'drink' && st.current?.drink ? itemPrice(st.current) : 0);

/* Descriptions used in the summary, dialogs and spoken read-back */
const drinkTitle = d => [d.size, d.temperature, d.drink ? plural(d.drink, d.quantity) : null].filter(Boolean).join(' ');
const itemDetails = d => [d.size, d.temperature, d.milk, d.extras && d.extras.length ? listText(d.extras) : null].filter(Boolean).join(' · ');
function spokenDrink(d){
  const parts = [];
  if (d.milk) parts.push(d.milk === 'No milk' ? 'no milk' : d.milk.toLowerCase());
  if (d.extras && d.extras.length) parts.push(...d.extras.map(e => e.toLowerCase()));
  const head = `${d.quantity || 1} ${drinkTitle(d).toLowerCase()}`;
  return parts.length ? `${head} with ${listText(parts)}` : head;
}
const shortDrink = d => Number(d.quantity) > 1 ? `${d.quantity} ${plural(d.drink, d.quantity)}` : `${article(d.drink)} ${d.drink}`;

/* ------------------------------------------------------------------ */
/* 2. Parsing                                                          */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9};
const NUM = '(?:[1-9]|one|two|three|four|five|six|seven|eight|nine)';
const GAP = '(?:(?!(?:in|minutes|mins|and)\\b)[a-z%0-9-]+\\s+){0,6}';
const DRINK_NOUN = '(?:lattes?|cappuccinos?|americanos?|mochas?|matchas?|chais?|cups?|drinks?|coffees?)';
const MENU_NOUN = '(?:lattes?|cappuccinos?|americanos?|mochas?|matchas?|chais?)';
// Order matters: "matcha latte" must match Matcha before the plain Latte rule.
const DRINK_PATTERNS = [
  [/\bmatchas?( lattes?)?\b/,'Matcha Latte'],[/\bchais?( tea)?( lattes?)?\b/,'Chai Latte'],
  [/\bcappuccinos?\b/,'Cappuccino'],[/\bamericanos?\b/,'Americano'],[/\bmochas?\b/,'Mocha'],[/\blattes?\b/,'Latte']
];
/** Words that belong to an order, so they are never accepted as a pickup name. */
const ORDER_WORDS = new Set(['latte','lattes','cappuccino','americano','mocha','matcha','chai','coffee','small','medium','large','hot','iced','oat','almond','soy','whole','milk','vanilla','caramel','whip','none','yes','no','nope','hello','hi','hey','skip','asap','pickup','counter']);

// Intent phrases. Checked against text with punctuation stripped.
const YES = /^(yes|yeah|yep|yup|sure|correct|confirm(ed)?|thats (right|correct)|that is (right|correct)|looks (good|right)|sounds good|perfect|go ahead|place (it|the order|my order)|ok|okay|absolutely|definitely)\b/;
const NO = /^(no|nope|nah|not quite|not really|wrong|incorrect|thats wrong)\b/;
const DONE = /\b(thats (it|all|everything)|nothing else|no more|(im|i am|were|we are|all) (done|good|set)|thats enough|just (that|this|those|the one)|everything)\b/;
const MORE = /\b(another|one more|add (a|an|one|another|something)|something else|more drinks?)\b/;
const CORRECTION = /\b(actually|instead|change|make (it|that|them|the|my|those)|switch|rather|swap|update|i meant|should be|i said|wanted)\b/;
const ADD = /^(and|also|plus)\b|\b(another|add|as well|too|also)\b/;
const REMOVE = /\b(remove|delete|take (off|out)|drop|get rid of|scratch|cancel)\b/;

function findDrink(s){
  for (const [re, name] of DRINK_PATTERNS) if (re.test(s)) return name;
  return null;
}

/**
 * Split one message into drink groups, e.g.
 * "a large latte with vanilla and caramel, and two mochas" →
 * ["a large latte with vanilla caramel", "two mochas"].
 * Pieces without a drink name stay attached to the drink they describe.
 */
function splitGroups(s){
  const parts = s.split(/\s*(?:,|;|&|\band\b|\bplus\b|\balso\b|\bthen\b)\s*/).filter(Boolean);
  const groups = [];
  for (const p of parts){
    if (!groups.length || findDrink(p)) groups.push(p);
    else groups[groups.length-1] += ' ' + p;
  }
  while (groups.length > 1 && !findDrink(groups[0])) groups.splice(0, 2, groups[0] + ' ' + groups[1]);
  return groups;
}

/** Drink attributes found in one group. Returns {attrs, invalid}. */
function parseDrink(s, focus){
  const r = {}, invalid = [];
  const has = re => re.test(s);
  const drink = findDrink(s);
  if (drink) r.drink = drink;

  if (has(/\b(extra large|extra-large|xl|trenta)\b/)) invalid.push({field:'size',text:'We offer small, medium, and large.'});
  else if (has(/\b(small|short)\b/)) r.size = 'Small';
  else if (has(/\b(medium|regular)\b/)) r.size = 'Medium';
  else if (has(/\b(large|big|venti)\b/)) r.size = 'Large';

  if (has(/\b(iced|ice|cold)\b/)) r.temperature = 'Iced';
  else if (has(/\b(hot|warm)\b/)) r.temperature = 'Hot';

  if (has(/\bcoconut\b/)) invalid.push({field:'milk',text:'Sorry, coconut milk isn’t on our menu. We have whole, 2%, oat, almond, soy, or no milk.'});
  else if (has(/\b(oat|oatmilk)\b/)) r.milk = 'Oat milk';
  else if (has(/\balmond\b/)) r.milk = 'Almond milk';
  else if (has(/\bsoy\b/)) r.milk = 'Soy milk';
  else if (has(/\bwhole\b/)) r.milk = 'Whole milk';
  else if (has(/(?:\b2%|\btwo percent\b|\b2 percent\b)/)) r.milk = '2% milk';
  else if (has(/\b(no milk|without milk|black)\b/)) r.milk = 'No milk';
  else if (focus === 'milk' && has(/^(no|none|nope)$/)) r.milk = 'No milk';

  const extras = [];
  if (has(/\bvanilla\b/)) extras.push('Vanilla syrup');
  if (has(/\bcaramel\b/)) extras.push('Caramel syrup');
  if (has(/\b(extra (espresso )?shots?|double shot|extra espresso)\b/)) extras.push('Extra espresso shot');
  if (has(/\b(whip|whipped( cream)?)\b/)) extras.push('Whipped cream');
  if (extras.length) r.extras = extras;
  else if ((focus === 'extras' && has(/\b(no|none|nothing|skip|nope)\b/)) || has(/\b(no extras|without extras|nothing extra)\b/)) r.extras = [];

  const q = s.match(new RegExp(`\\b(${NUM})\\s+${GAP}${DRINK_NOUN}\\b`));
  if (q) r.quantity = String(NUMBER_WORDS[q[1]] || Number(q[1]));
  else if (focus === 'quantity'){
    const m = s.match(new RegExp(`^(?:just |only )?(${NUM})(?: please)?$`));
    if (m) r.quantity = String(NUMBER_WORDS[m[1]] || Number(m[1]));
    else if (/^\d+$/.test(s) && Number(s) > 9) invalid.push({field:'quantity',text:'Please choose between 1 and 9 drinks.'});
  }
  // "a latte" means one latte, but never overrides a quantity already chosen.
  if (!r.quantity && new RegExp(`\\b(a|an|single)\\s+${GAP}${MENU_NOUN}\\b`).test(s)) r.softQuantity = '1';
  return {attrs:r, invalid};
}

/** Order-level answers (pickup time, name, payment) found anywhere in the message. */
function parseDetails(s, focus){
  const r = {}, invalid = [];
  if (/\b(asap|as soon as possible|right away|now)\b/.test(s)) r.pickup = 'As soon as possible';
  else {
    const t = s.match(/\b(?:in\s+)?(10|15|20)\s*(?:minutes?|mins?)\b/);
    if (t) r.pickup = `In ${t[1]} minutes`;
    else if (focus === 'pickup' && /^(10|15|20)$/.test(s)) r.pickup = `In ${s} minutes`;
  }
  if (/\b(pay at pickup|at pickup|when i pick (it|them) up)\b/.test(s)) r.payment = 'Pay at pickup';
  else if (/\b(pay at counter|at the counter|at counter|in store|in-store|at the store)\b/.test(s)) r.payment = 'Pay at counter';
  else if (focus === 'payment' && /\b(counter|store|cashier)\b/.test(s)) r.payment = 'Pay at counter';
  else if (focus === 'payment' && /\b(pick ?up|later)\b/.test(s)) r.payment = 'Pay at pickup';

  const explicit = s.match(/\b(?:my name is|name is|call me|under the name)\s+([a-z][a-z-]*)/)?.[1];
  const bare = focus === 'name' ? s.match(/^(?:its |im |i am |it is |for )?([a-z][a-z-]*)$/)?.[1] : null;
  const name = explicit || bare;
  if (name){
    if (name.length <= 30 && !ORDER_WORDS.has(name)) r.name = name[0].toUpperCase() + name.slice(1);
    else if (focus === 'name') invalid.push({field:'name',text:'That sounds like part of a drink order rather than a name.'});
  }
  return {attrs:r, invalid};
}

/** Parse a whole message. Returns {groups, details, invalid}. */
function parseInput(s, focus, bare = s){
  const details = parseDetails(s, focus);
  const invalid = [...details.invalid];
  let groups = [];
  // While asking for a name, only treat drink words as an order change if the user clearly says so.
  if (focus !== 'name' || CORRECTION.test(bare) || ADD.test(bare)){
    for (const g of splitGroups(s)){
      const p = parseDrink(g, focus);
      invalid.push(...p.invalid);
      if (Object.keys(p.attrs).some(k => k !== 'softQuantity')) groups.push(p.attrs);
    }
  }
  return {groups, details:details.attrs, invalid};
}

/* ------------------------------------------------------------------ */
/* 3. Conversation engine                                              */
/* ------------------------------------------------------------------ */

/** Copy attributes from a parsed group onto a drink. Returns a readable list of what changed. */
function applyTo(target, g, adding){
  const changed = [];
  for (const f of DRINK_FIELDS){
    if (g[f.key] === undefined) continue;
    let value = g[f.key];
    if (f.key === 'extras' && adding && Array.isArray(target.extras) && value.length) value = [...new Set([...target.extras, ...value])];
    if (JSON.stringify(target[f.key]) !== JSON.stringify(value)){
      target[f.key] = Array.isArray(value) ? [...value] : value;
      changed.push(`${f.label.toLowerCase()}: ${f.key === 'extras' ? extrasText(value).toLowerCase() : value}`);
    }
  }
  if (g.softQuantity && target.quantity === null){ target.quantity = g.softQuantity; changed.push('quantity: 1'); }
  return changed.join(', ');
}

function toDrink(g){
  const d = emptyDrink();
  for (const f of DRINK_FIELDS) if (g[f.key] !== undefined) d[f.key] = Array.isArray(g[f.key]) ? [...g[f.key]] : g[f.key];
  if (d.quantity === null && g.softQuantity) d.quantity = g.softQuantity;
  return d;
}

/**
 * Move the conversation forward after any change: finished drinks go into the cart,
 * queued drinks start, and the stage is corrected if details or drinks changed.
 */
function settle(st){
  const added = []; let fromQueue = false;
  if (st.stage === 'drink' && !st.current) st.current = emptyDrink();
  while (st.stage === 'drink' && st.current && !drinkMissing(st.current)){
    added.push(st.current); st.items.push(st.current); st.pin = null;
    if (st.queue.length){ st.current = {...emptyDrink(), ...st.queue.shift()}; fromQueue = true; }
    else { st.current = null; st.stage = 'more'; fromQueue = false; }
  }
  if (st.pin && (!st.current || st.current[st.pin] !== null)) st.pin = null;
  if (!st.items.length && st.stage !== 'drink'){ st.stage = 'drink'; st.current = st.current || emptyDrink(); }
  if (st.stage === 'details' || st.stage === 'confirm') st.stage = detailMissing(st) ? 'details' : 'confirm';
  return {added, fromQueue};
}

function questionFor(st, key){
  if (!key) return '';
  if (key === 'drink' && st.items.length) return 'What else can I get you? Pick a drink or tell me what you’d like.';
  if (key === 'quantity' && st.current?.drink) return `How many ${plural(st.current.drink, 2)} would you like?`;
  return field(key).question;
}

const pickupPhrase = p => p === 'As soon as possible' ? 'as soon as possible' : p.toLowerCase();
function confirmText(st){
  const d = st.details;
  return `Please confirm: ${st.items.map(spokenDrink).join(', plus ')}. Pickup ${pickupPhrase(d.pickup)} for ${d.name}, and you’ll ${d.payment === 'Pay at counter' ? 'pay at the counter' : 'pay at pickup'}. Estimated total ${money(orderTotal(st))}. Is that correct?`;
}

function nextPrompt(st){
  if (st.finished) return '';
  if (st.stage === 'drink') return questionFor(st, activeField(st));
  if (st.stage === 'more') return 'Anything else? You can add another drink, or say “that’s everything”.';
  if (st.stage === 'details') return questionFor(st, detailMissing(st));
  if (st.stage === 'confirm') return confirmText(st);
  return '';
}

function finish(st, before, notes){
  const {added, fromQueue} = settle(st);
  const parts = notes.slice();
  if (added.length) parts.push(`Added to your order: ${listText(added.map(spokenDrink))}.`);
  if (fromQueue && st.current) parts.push(`Now for your ${st.current.drink}.`);
  parts.push(nextPrompt(st));
  return {reply:parts.filter(Boolean).join(' '), changed:JSON.stringify(st) !== before};
}

/** Remove a drink, or extras from a drink ("remove the mocha", "take off the whipped cream"). */
function handleRemove(st, s, before){
  const drink = findDrink(s);
  const extras = parseDrink(s, null).attrs.extras;
  if (drink){
    if (st.stage === 'drink' && st.current?.drink === drink){
      st.current = st.queue.length ? {...emptyDrink(), ...st.queue.shift()} : (st.items.length ? null : emptyDrink());
      if (!st.current) st.stage = 'more';
      return finish(st, before, [`Okay, I removed the ${drink}.`]);
    }
    const qi = lastIndexWhere(st.queue, d => d.drink === drink);
    if (qi >= 0){ st.queue.splice(qi, 1); return finish(st, before, [`Okay, I won’t add the ${drink}.`]); }
    const idx = lastIndexWhere(st.items, d => d.drink === drink);
    if (idx >= 0){ st.items.splice(idx, 1); return finish(st, before, [`Okay, I removed the ${drink} from your order.`]); }
    return {reply:`There’s no ${drink} in your order right now. ${nextPrompt(st)}`, changed:false};
  }
  if (extras && extras.length){
    const target = (st.stage === 'drink' && Array.isArray(st.current?.extras)) ? st.current : st.items[st.items.length-1];
    if (target && Array.isArray(target.extras)){
      target.extras = target.extras.filter(e => !extras.includes(e));
      return finish(st, before, [`Okay, removed ${listText(extras).toLowerCase()}${target.drink ? ' from your ' + target.drink : ''}.`]);
    }
  }
  return null;
}

/**
 * Main entry point. Mutates `st` and returns {reply, changed, action?}.
 * action === 'complete' means the user confirmed the order by voice or text.
 */
function respond(st, text){
  const s = norm(text);
  const bare = s.replace(/[^a-z0-9% -]/g,' ').replace(/\s+/g,' ').trim();
  if (!s) return {reply:'', changed:false};
  if (st.finished) return {reply:'That order is already confirmed. Choose “Make another order” to start a fresh one.', changed:false};
  const before = JSON.stringify(st);

  if (REMOVE.test(bare)){
    const out = handleRemove(st, s, before);
    if (out) return out;
  }

  const focus = activeField(st);
  const parsed = parseInput(s, focus, bare);
  const groups = parsed.groups;
  const nothingParsed = !groups.length && !Object.keys(parsed.details).length && !parsed.invalid.length;

  // Yes/no style answers
  if (nothingParsed){
    if (st.stage === 'confirm'){
      if (YES.test(bare)) return {reply:'', changed:true, action:'complete'};
      if (NO.test(bare)) return {reply:'No problem. What would you like to change? You could say “make the latte oat milk”, “remove the mocha”, or tap Change answer.', changed:false};
    }
    if (st.stage === 'more'){
      if (DONE.test(bare) || NO.test(bare)){ st.stage = 'details'; return finish(st, before, ['Great!']); }
      if (YES.test(bare) || MORE.test(bare)){ st.current = emptyDrink(); st.stage = 'drink'; return finish(st, before, ['Sure!']); }
    }
  }

  const notes = [];
  const correction = CORRECTION.test(bare);
  const adding = ADD.test(bare);
  const building = st.stage === 'drink';
  const newDrinks = [];

  groups.forEach((g, i) => {
    // "Make the latte oat milk" → change the latte already in the cart.
    const namesExisting = g.drink && (correction || (st.stage === 'confirm' && !adding));
    if (namesExisting){
      const idx = lastIndexWhere(st.items, d => d.drink === g.drink);
      if (idx >= 0 && !(building && st.current?.drink === g.drink)){
        const {drink, ...rest} = g;
        const ch = applyTo(st.items[idx], rest, adding);
        notes.push(ch ? `Updated your ${g.drink}: ${ch}.` : `Your ${g.drink} already has that.`);
        return;
      }
    }
    // The drink being built right now.
    if (building && i === 0 && !(st.current.drink && g.drink && g.drink !== st.current.drink && adding && !correction)){
      const ch = applyTo(st.current, g, adding);
      if (ch) notes.push(`Got it: ${ch}.`);
      return;
    }
    // A new drink.
    if (g.drink && (building || !correction)){ newDrinks.push(g); return; }
    // No drink named after the cart is built → correct the most recent drink.
    if (st.items.length){
      const d = st.items[st.items.length-1];
      const ch = applyTo(d, g, adding);
      if (ch) notes.push(`Updated your ${d.drink}: ${ch}.`);
      return;
    }
    if (building){ const ch = applyTo(st.current, g, adding); if (ch) notes.push(`Got it: ${ch}.`); }
  });

  if (newDrinks.length){
    const drinks = newDrinks.map(toDrink);
    const names = listText(drinks.map(shortDrink));
    if (building){ st.queue.push(...drinks); notes.push(`I’ll set up ${names} right after this one.`); }
    else { st.current = drinks.shift(); st.queue.push(...drinks); st.stage = 'drink'; notes.push(`Sure, let’s add ${names}.`); }
  }

  const detailNotes = [];
  for (const [k, v] of Object.entries(parsed.details)){
    if (st.details[k] !== v){ st.details[k] = v; detailNotes.push(`${field(k).label.toLowerCase()}: ${v}`); }
  }
  if (detailNotes.length) notes.push(`Noted: ${detailNotes.join(', ')}.`);

  for (const inv of parsed.invalid){
    notes.push(inv.text);
    // Ask about the invalid field next so its choices appear as quick replies.
    if (st.stage === 'drink' && st.current && ['milk','size'].includes(inv.field) && st.current[inv.field] === null) st.pin = inv.field;
  }

  if (!notes.length){
    if (focus === 'name') return {reply:'Please tell me just your first name, using letters.', changed:false};
    if (focus === 'quantity') return {reply:'Please choose a quantity between 1 and 9.', changed:false};
    const q = st.stage === 'more' ? 'Would you like another drink, or is that everything?'
      : st.stage === 'confirm' ? 'Is your order correct? Say “yes” to place it, or tell me what to change.'
      : questionFor(st, focus);
    return {reply:`I didn’t quite catch that. ${q} You can also tap an option below.`, changed:false};
  }
  return finish(st, before, notes);
}

/* ------------------------------------------------------------------ */
/* 4. Browser UI                                                       */
/* ------------------------------------------------------------------ */

const $ = id => document.getElementById(id);
let st = freshState(), messages = [], history = [], muted = true;
let recognition = null, listening = false, voiceCandidate = null;
const extrasPick = new Set();   // extras toggled with the quick-reply chips
const STATUS_LABELS = {idle:'Ready to help',listening:'Listening to you…',thinking:'Putting it together…',speaking:'Speaking…',waiting:'Waiting for your reply',done:'Your order is ready!'};
const FILE_VOICE_HELP = 'Voice input is blocked because this page was opened straight from a file. Double-click start-server.bat in the project folder (or run “python serve.py” there). It opens the site at a localhost address in your browser; use Chrome or Edge. You can keep typing or tapping in the meantime.';

const snapshot = () => JSON.parse(JSON.stringify({st, messages}));

function addMessage(role, content){ messages.push({role, content}); renderMessages(); }
function renderMessages(){
  const target = $('messages');
  target.innerHTML = messages.map(m => `<div class="message ${m.role}"><span class="message-label">${m.role === 'assistant' ? 'BEANIE' : 'YOU'}</span>${esc(m.content)}</div>`).join('');
  target.scrollTop = target.scrollHeight;
}
function status(s){
  $('avatar-stage').dataset.state = s;
  $('avatar-status').innerHTML = `<span class="status-indicator"></span> ${STATUS_LABELS[s] || STATUS_LABELS.idle}`;
}

/** Text-to-speech. Long replies are spoken sentence by sentence (Chrome cuts off long utterances). */
function speak(text, endState = 'waiting'){
  if (muted || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const parts = (text.match(/[^.!?]+[.!?]*/g) || [text]).map(clean).filter(Boolean);
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = 'en-CA'; u.rate = 1.04; u.pitch = 1.15;
    if (i === 0) u.onstart = () => status('speaking');
    if (i === parts.length - 1){ u.onend = () => status(endState); u.onerror = () => status(endState); }
    window.speechSynthesis.speak(u);
  });
}
function say(text){ addMessage('assistant', text); status('waiting'); speak(text); }

function renderMenu(){
  const chosen = new Set([...st.items.map(d => d.drink), st.current?.drink].filter(Boolean));
  $('menu-items').innerHTML = MENU.map(x => `<button class="menu-item ${chosen.has(x.name) ? 'selected' : ''}" data-drink="${esc(x.name)}" type="button"><span class="menu-icon ${x.className}" style="background:${x.bg}" aria-hidden="true"><i></i></span><span><span class="menu-item-title">${esc(x.name)}</span><span class="menu-item-sub">${esc(x.sub)}</span><span class="menu-item-price">From ${money(x.price)}</span></span></button>`).join('');
  document.querySelectorAll('[data-drink]').forEach(b => b.addEventListener('click', () => { if (!st.finished) submitText(b.dataset.drink); }));
}

function summaryLine(f, value, editId){
  const shown = f.key === 'extras' ? extrasText(value) : (value ?? 'Not chosen');
  return `<div class="summary-line"><span class="label">${esc(f.label)}</span><span class="value">${esc(shown)}<button type="button" data-edit="${editId}" aria-label="Edit ${esc(f.label)}">Edit</button></span></div>`;
}

function renderSummary(){
  const box = $('order-summary');
  const started = st.items.length || (st.current && Object.values(st.current).some(v => v !== null)) || Object.values(st.details).some(v => v !== null);
  if (!started){
    box.innerHTML = '<div class="summary-empty"><span class="empty-illustration" aria-hidden="true">☕</span><strong>Your cup is waiting.</strong><p>Start ordering and watch your drinks come together.</p></div>';
  } else {
    let html = '';
    st.items.forEach((d, i) => {
      html += `<div class="cart-item"><div class="cart-item-main"><strong>${esc(d.quantity)} × ${esc(d.drink)}</strong><span>${esc(itemDetails(d))}</span></div><div class="cart-item-side"><span class="cart-item-price">${money(itemPrice(d))}</span><span class="cart-item-actions"><button type="button" data-edit="i${i}-size" aria-label="Edit drink ${i+1}, ${esc(d.drink)}">Edit</button><button type="button" data-remove="${i}" aria-label="Remove drink ${i+1}, ${esc(d.drink)}">Remove</button></span></div></div>`;
    });
    if (st.stage === 'drink' && st.current){
      html += `<div class="cart-item in-progress"><div class="cart-item-main"><span class="cart-badge">${st.items.length ? `Drink ${st.items.length + 1} · in progress` : 'In progress'}</span><strong>${esc(st.current.drink || 'Choosing a drink…')}</strong></div></div>`;
      html += DRINK_FIELDS.map(f => summaryLine(f, st.current[f.key], `cur-${f.key}`)).join('');
    }
    if (st.queue.length) html += `<p class="cart-queue">Up next: ${esc(listText(st.queue.map(shortDrink)))}</p>`;
    html += '<div class="summary-subhead">Pickup details</div>' + DETAIL_FIELDS.map(f => summaryLine(f, st.details[f.key], `details-${f.key}`)).join('');
    box.innerHTML = html;
  }
  $('total-price').textContent = money(orderTotal(st));
  $('review-button').disabled = st.stage !== 'confirm' || st.finished;
  box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.edit)));
  box.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => removeItem(Number(b.dataset.remove))));
  renderMenu();
}

function renderChips(){
  const dest = $('quick-replies');
  const input = $('message-input');
  if (st.finished){ dest.innerHTML = ''; return; }
  const key = activeField(st);
  let html = '';
  if (st.stage === 'more'){
    html = ['Add another drink','That’s everything'].map(c => `<button type="button" class="quick-reply" data-choice="${esc(c)}">${esc(c)}</button>`).join('');
    input.placeholder = 'Add a drink, or say “that’s everything”…';
  } else if (st.stage === 'confirm'){
    html = ['Yes, place my order','No, make a change'].map(c => `<button type="button" class="quick-reply" data-choice="${esc(c)}">${esc(c)}</button>`).join('');
    input.placeholder = 'Say “yes”, or tell me what to change…';
  } else if (key === 'extras'){
    // Extras can be combined: chips toggle, then "Add selected" sends them together.
    html = EXTRAS.map(c => `<button type="button" class="quick-reply toggle" data-toggle="${esc(c)}" aria-pressed="${extrasPick.has(c)}">${extrasPick.has(c) ? '✓ ' : ''}${esc(c)}</button>`).join('')
      + (extrasPick.size ? `<button type="button" class="quick-reply primary" data-choice="${esc(listText([...extrasPick]))}">Add selected (${extrasPick.size}) →</button>` : '')
      + '<button type="button" class="quick-reply" data-choice="None">None</button>';
    input.placeholder = 'Try “vanilla and an extra shot”…';
  } else {
    const f = field(key);
    html = (f?.choices || []).map(c => `<button type="button" class="quick-reply" data-choice="${esc(c)}">${esc(c)}</button>`).join('');
    input.placeholder = key === 'name' ? 'Type your first name…' : (key === 'drink' && !st.items.length) ? 'Try “Two large iced lattes and a mocha”…' : 'Type your answer…';
  }
  dest.innerHTML = html;
  dest.querySelectorAll('[data-choice]').forEach(el => el.addEventListener('click', () => submitText(el.dataset.choice)));
  dest.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('click', () => {
    const v = el.dataset.toggle;
    extrasPick.has(v) ? extrasPick.delete(v) : extrasPick.add(v);
    renderChips();
    dest.querySelector(`[data-toggle="${CSS.escape(v)}"]`)?.focus();
  }));
}

function refresh(){ renderSummary(); renderChips(); $('back-button').disabled = history.length === 0; }

/** Send typed, tapped, or accepted voice text to the conversation engine. */
function handleInput(text){
  const raw = clean(text);
  if (!raw) return;
  const snap = snapshot();
  addMessage('user', raw);
  status('thinking');
  const out = respond(st, raw);
  if (out.changed){ history.push(snap); if (history.length > 40) history.shift(); }
  extrasPick.clear();
  if (out.action === 'complete'){ complete(); return; }
  refresh();
  say(out.reply);
}
function submitText(s){
  hideVoicePreview();
  voiceCandidate = null;
  stopListening();
  handleInput(s);
  $('message-input').value = '';
}

function removeItem(i){
  const d = st.items[i];
  if (!d || st.finished) return;
  history.push(snapshot());
  st.items.splice(i, 1);
  addMessage('user', `Remove the ${d.drink}.`);
  const out = finish(st, '', [`Okay, I removed the ${d.drink}.`]);
  refresh();
  say(out.reply);
}

function reset(){
  stopListening();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  st = freshState(); messages = []; history = []; voiceCandidate = null; extrasPick.clear();
  hideVoicePreview();
  refresh(); renderMessages();
  say('Hey there! I’m Beanie, your coffee buddy. Tell me what you’re craving, or tap a drink to begin. You can order more than one drink. ☕');
}

/* ----- Edit dialog: every drink plus the pickup details, editable without restarting ----- */

function selectField(id, label, options, value){
  return `<div class="edit-field"><label for="${id}">${esc(label)}</label><select id="${id}"><option value="">Choose…</option>${options.map(v => `<option value="${esc(v)}" ${value === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>`;
}
function drinkFieldset(title, prefix, d){
  const rows = DRINK_FIELDS.map(f => {
    if (f.key === 'extras'){
      const none = Array.isArray(d.extras) && !d.extras.length;
      return `<div class="edit-field edit-field-wide"><span class="edit-label" id="edit-${prefix}-extras-label">Extras (choose any)</span><div class="check-group" role="group" aria-labelledby="edit-${prefix}-extras-label">${EXTRAS.map((e, n) => `<label><input type="checkbox" name="${prefix}-extras" value="${esc(e)}" id="edit-${prefix}-extras${n ? '-' + n : ''}" ${d.extras?.includes(e) ? 'checked' : ''}/> ${esc(e)}</label>`).join('')}<label><input type="checkbox" name="${prefix}-extras" value="None" ${none ? 'checked' : ''}/> None</label></div></div>`;
    }
    const options = f.key === 'quantity' ? Array.from({length:9}, (_, n) => String(n + 1)) : f.choices;
    return selectField(`edit-${prefix}-${f.key}`, f.label, options, d[f.key]);
  }).join('');
  return `<fieldset class="edit-section"><legend>${esc(title)}</legend><div class="edit-grid">${rows}</div></fieldset>`;
}
function openEdit(focusId){
  if (st.finished) return;
  const sections = st.items.map((d, i) => drinkFieldset(`Drink ${i + 1}: ${d.drink}`, `i${i}`, d));
  if (st.stage === 'drink' && st.current) sections.push(drinkFieldset(st.items.length ? `Drink ${st.items.length + 1} (in progress)` : 'Your drink (in progress)', 'cur', st.current));
  const d = st.details;
  sections.push(`<fieldset class="edit-section"><legend>Pickup details</legend><div class="edit-grid">${selectField('edit-details-pickup', 'Pickup time', DETAIL_FIELDS[0].choices, d.pickup)}<div class="edit-field"><label for="edit-details-name">Pickup name</label><input id="edit-details-name" maxlength="30" value="${esc(d.name || '')}" placeholder="First name" autocomplete="given-name"/></div>${selectField('edit-details-payment', 'Payment', DETAIL_FIELDS[2].choices, d.payment)}</div></fieldset>`);
  $('edit-fields').innerHTML = sections.join('');
  $('edit-error').textContent = '';
  // "None" and specific extras are mutually exclusive.
  $('edit-fields').querySelectorAll('.check-group').forEach(group => group.addEventListener('change', e => {
    const boxes = [...group.querySelectorAll('input')];
    if (e.target.value === 'None' && e.target.checked) boxes.forEach(b => { if (b !== e.target) b.checked = false; });
    else if (e.target.checked) boxes.find(b => b.value === 'None').checked = false;
  }));
  $('edit-dialog').showModal();
  if (focusId) setTimeout(() => $('edit-' + focusId)?.focus(), 0);
}
function readDrink(prefix, required){
  const d = emptyDrink();
  for (const f of DRINK_FIELDS){
    if (f.key === 'extras'){
      const picked = [...document.querySelectorAll(`[name="${prefix}-extras"]:checked`)].map(b => b.value);
      d.extras = picked.includes('None') ? [] : picked.length ? picked : (required ? [] : null);
    } else d[f.key] = $(`edit-${prefix}-${f.key}`).value || null;
  }
  return d;
}
function saveEdit(){
  const error = msg => { $('edit-error').textContent = msg; return false; };
  const items = [];
  for (let i = 0; i < st.items.length; i++){
    const d = readDrink(`i${i}`, true);
    const missing = DRINK_FIELDS.find(f => d[f.key] === null);
    if (missing) return error(`Please choose a ${missing.label.toLowerCase()} for drink ${i + 1}, or close this and remove the drink.`);
    items.push(d);
  }
  const current = (st.stage === 'drink' && st.current) ? readDrink('cur', false) : st.current;
  const name = clean($('edit-details-name').value);
  if (name && !/^[A-Za-z][A-Za-z' -]{0,29}$/.test(name)) return error('Please enter a first name using letters only.');
  const details = {pickup:$('edit-details-pickup').value || null, name:name || null, payment:$('edit-details-payment').value || null};
  const next = {...st, items, current, details};
  if (JSON.stringify(next) === JSON.stringify(st)) return true;
  history.push(snapshot());
  st = next;
  addMessage('user', 'Updated my order details.');
  const out = finish(st, '', ['All updated!']);
  refresh();
  say(out.reply);
  return true;
}

/* ----- Review, confirmation, success ----- */

function reviewRows(){
  const rows = st.items.map(d => `<div class="review-row"><span>${esc(d.quantity)} × ${esc(d.drink)}<small>${esc(itemDetails(d))}</small></span><strong>${money(itemPrice(d))}</strong></div>`);
  rows.push(`<div class="review-row"><span>Pickup</span><strong>${esc(st.details.pickup)} · ${esc(st.details.name)}</strong></div>`);
  rows.push(`<div class="review-row"><span>Payment</span><strong>${esc(st.details.payment)}</strong></div>`);
  rows.push(`<div class="review-row"><span>Estimated total</span><strong>${money(orderTotal(st))}</strong></div>`);
  return `<div class="review-rows">${rows.join('')}</div>`;
}
function review(){
  if (st.stage !== 'confirm'){ say(`We still need a few details. ${nextPrompt(st)}`); return; }
  $('confirm-content').innerHTML = reviewRows() + '<p class="demo-note">Demo only. No real pickup, payment, or order processing occurs.</p>';
  $('confirm-dialog').showModal();
}
function complete(){
  if (st.stage !== 'confirm' || st.finished) return;
  if ($('confirm-dialog').open) $('confirm-dialog').close();
  st.finished = true; st.stage = 'done';
  refresh();
  const code = 'LB-' + String(Math.floor(1000 + Math.random() * 9000));
  $('order-code').textContent = code;
  $('success-summary').innerHTML = reviewRows();
  $('success-dialog').showModal();
  const msg = `Your order ${code} is confirmed! See you soon, ${st.details.name}. This is a prototype, so no real order has been placed.`;
  addMessage('assistant', msg);
  status('done');
  speak(msg, 'done');
}

/* ----- Voice input (Web Speech API) ----- */

function showVoicePreview(label, text, final){
  $('voice-label').textContent = label;
  $('voice-transcript').textContent = text || '…';
  $('voice-actions').hidden = !final;
  $('voice-preview').classList.remove('hidden');
}
function hideVoicePreview(){ $('voice-preview').classList.add('hidden'); }
function setMicActive(on){
  $('mic-button').classList.toggle('active', on);
  $('mic-button').setAttribute('aria-label', on ? 'Stop voice input' : 'Start voice input');
  $('mic-button').setAttribute('aria-pressed', String(on));
}
function stopListening(){
  if (recognition && listening){ try { recognition.abort(); } catch (_) {} }
  listening = false;
  setMicActive(false);
}

function setupVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const onFile = location.protocol === 'file:';
  if (onFile) $('access-note').textContent = 'Voice input needs the page served from localhost: run start-server.bat (see README). Typing and tapping work here.';
  if (!SR){
    $('mic-button').title = 'Speech recognition is unavailable in this browser. You can still type or tap.';
    $('mic-button').addEventListener('click', () => say('Voice input isn’t supported in this browser. Please use Chrome or Edge, or type or tap a choice instead.'));
    return;
  }
  recognition = new SR();
  recognition.lang = 'en-CA';
  recognition.continuous = false;
  recognition.interimResults = true;   // show words as they are heard
  recognition.maxAlternatives = 1;

  recognition.onstart = () => { listening = true; setMicActive(true); status('listening'); showVoicePreview('LISTENING…', '', false); };
  recognition.onresult = e => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++){
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    if (final){
      voiceCandidate = clean(final);
      showVoicePreview('I HEARD', voiceCandidate, true);
      status('waiting');
    } else showVoicePreview('LISTENING…', interim, false);
  };
  recognition.onerror = e => {
    if (e.error === 'aborted') return;
    hideVoicePreview();
    status('waiting');
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
      say(onFile ? FILE_VOICE_HELP : 'Microphone permission is blocked. Click the microphone icon in the address bar to allow it, then try again. You can type or tap instead.');
    else if (e.error === 'no-speech') say('I didn’t hear anything. Press the microphone and try again, or type your answer.');
    else if (e.error === 'audio-capture') say('I can’t find a microphone. Check that one is connected and not being used by another app, or type instead.');
    else if (e.error === 'network') say('Voice recognition couldn’t reach the browser’s speech service. Chrome and Edge need an internet connection for it. You can type or tap instead.');
    else if (e.error === 'language-not-supported'){ recognition.lang = 'en-US'; say('Let’s try that again. Press the microphone to speak.'); }
    else say('Voice input had trouble this time. You can retry or type instead.');
  };
  recognition.onend = () => {
    listening = false;
    setMicActive(false);
    if (!voiceCandidate) hideVoicePreview();
    if ($('avatar-stage').dataset.state === 'listening') status('waiting');
  };
  $('mic-button').addEventListener('click', () => {
    if (listening){ stopListening(); return; }
    if (st.finished) return;
    // Stop Beanie talking first so the microphone doesn't pick up the avatar's own voice.
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    hideVoicePreview();
    voiceCandidate = null;
    try { recognition.start(); }
    catch (_){ try { recognition.abort(); } catch (__) {} say('Unable to start voice input. Press the microphone again, or type your answer.'); }
  });
}

/* ----- Wiring ----- */

function init(){
  renderMenu();
  $('composer').addEventListener('submit', e => { e.preventDefault(); submitText($('message-input').value); });
  $('reset-button').addEventListener('click', () => {
    const started = st.items.length || st.current?.drink || Object.values(st.details).some(Boolean);
    if (!started || confirm('Start a new order? Your current answers will be cleared.')) reset();
  });
  $('back-button').addEventListener('click', () => {
    const prev = history.pop();
    if (!prev) return;
    st = prev.st; messages = prev.messages; st.finished = false; extrasPick.clear();
    renderMessages(); refresh();
    say(`No worries, we’re back! ${nextPrompt(st)}`);
  });
  $('change-button').addEventListener('click', () => openEdit());
  $('mute-button').addEventListener('click', () => {
    muted = !muted;
    if (muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    $('mute-button').setAttribute('aria-pressed', String(!muted));
    $('mute-button').innerHTML = muted ? '◌ <span>Voice off</span>' : '♫ <span>Voice on</span>';
    if (!muted) say('Voice replies are on. You can mute me anytime.');
  });
  $('review-button').addEventListener('click', review);
  $('close-edit').addEventListener('click', () => $('edit-dialog').close());
  $('cancel-edit').addEventListener('click', () => $('edit-dialog').close());
  $('edit-form').addEventListener('submit', e => { e.preventDefault(); if (saveEdit()) $('edit-dialog').close(); });
  $('close-confirm').addEventListener('click', () => $('confirm-dialog').close());
  $('confirm-edit').addEventListener('click', () => { $('confirm-dialog').close(); openEdit(); });
  $('place-order').addEventListener('click', () => { if (!st.finished){ history.push(snapshot()); complete(); } });
  $('new-order').addEventListener('click', () => { $('success-dialog').close(); reset(); });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-ok').addEventListener('click', () => $('help-dialog').close());
  $('voice-accept').addEventListener('click', () => { if (voiceCandidate) submitText(voiceCandidate); });
  $('voice-edit').addEventListener('click', () => { $('message-input').value = voiceCandidate || ''; hideVoicePreview(); $('message-input').focus(); });
  $('voice-retry').addEventListener('click', () => { hideVoicePreview(); voiceCandidate = null; $('mic-button').click(); });
  setupVoice();
  reset();
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
if (typeof module !== 'undefined') module.exports = {respond, parseInput, settle, freshState, emptyDrink, activeField, spokenDrink, itemPrice, orderTotal, confirmText, MENU, FIELDS, DRINK_FIELDS, DETAIL_FIELDS};

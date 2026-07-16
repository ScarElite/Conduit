// Minimal CDP driver for the dev Conduit instance on :9222.
// Usage: node cdp-drive.mjs <action> [arg]
//   focus            — focus xterm's hidden textarea
//   ctrlv            — dispatch Ctrl+V keydown/keyup
//   ctrlshiftv       — dispatch Ctrl+Shift+V
//   enter            — press Enter
//   rightclick       — right-click the terminal pane center
//   shot <file.png>  — capture a screenshot
import { writeFileSync } from 'node:fs';

const [action, arg] = process.argv.slice(2);

const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

const key = (type, k, code, vk, modifiers) =>
  send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });

if (action === 'focus') {
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const t = document.querySelector('.xterm-helper-textarea'); if (t) { t.focus(); return 'focused'; } return 'no textarea'; })()`,
    returnByValue: true,
  });
  console.log(r.result.value);
} else if (action === 'ctrlv' || action === 'ctrlshiftv') {
  const mods = action === 'ctrlv' ? 2 : 2 | 8; // Ctrl | Shift
  await key('rawKeyDown', 'Control', 'ControlLeft', 17, 2);
  if (action === 'ctrlshiftv') await key('rawKeyDown', 'Shift', 'ShiftLeft', 16, mods);
  await key('rawKeyDown', action === 'ctrlv' ? 'v' : 'V', 'KeyV', 86, mods);
  await key('keyUp', action === 'ctrlv' ? 'v' : 'V', 'KeyV', 86, mods);
  if (action === 'ctrlshiftv') await key('keyUp', 'Shift', 'ShiftLeft', 16, 2);
  await key('keyUp', 'Control', 'ControlLeft', 17, 0);
  console.log('sent ' + action);
} else if (action === 'enter') {
  await key('rawKeyDown', 'Enter', 'Enter', 13, 0);
  await key('keyUp', 'Enter', 'Enter', 13, 0);
  console.log('sent enter');
} else if (action === 'rightclick') {
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector('.xterm-screen') || document.body; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
    returnByValue: true,
  });
  const { x, y } = r.result.value;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'right', x, y, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'right', x, y, clickCount: 1 });
  console.log(`right-clicked ${Math.round(x)},${Math.round(y)}`);
} else if (action === 'ctrlc') {
  await key('rawKeyDown', 'Control', 'ControlLeft', 17, 2);
  await key('rawKeyDown', 'c', 'KeyC', 67, 2);
  await key('keyUp', 'c', 'KeyC', 67, 2);
  await key('keyUp', 'Control', 'ControlLeft', 17, 0);
  console.log('sent ctrl+c');
} else if (action === 'csk') {
  // Ctrl+Shift+<Home|End|ArrowUp|ArrowDown>
  const vk = { Home: 36, End: 35, ArrowUp: 38, ArrowDown: 40 }[arg];
  const mods = 2 | 8; // Ctrl | Shift
  await key('rawKeyDown', 'Control', 'ControlLeft', 17, 2);
  await key('rawKeyDown', 'Shift', 'ShiftLeft', 16, mods);
  await key('rawKeyDown', arg, arg, vk, mods);
  await key('keyUp', arg, arg, vk, mods);
  await key('keyUp', 'Shift', 'ShiftLeft', 16, 2);
  await key('keyUp', 'Control', 'ControlLeft', 17, 0);
  console.log('sent ctrl+shift+' + arg);
} else if (action === 'wheel') {
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector('.xterm-screen') || document.body; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
    returnByValue: true,
  });
  const { x, y } = r.result.value;
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: Number(arg) });
  console.log(`wheel ${arg}`);
} else if (action === 'click') {
  const [x, y] = arg.split(',').map(Number);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await new Promise((r) => setTimeout(r, 300)); // let the link provider register hover
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', x, y, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', x, y, clickCount: 1 });
  console.log(`clicked ${x},${y}`);
} else if (action === 'backspace') {
  const n = Number(arg ?? 1);
  for (let i = 0; i < n; i++) {
    await key('rawKeyDown', 'Backspace', 'Backspace', 8, 0);
    await key('keyUp', 'Backspace', 'Backspace', 8, 0);
    await new Promise((r) => setTimeout(r, 30));
  }
  console.log(`sent ${n} backspaces`);
} else if (action === 'dblclick') {
  // dblclick "x,y" — double left click (word-select in xterm)
  const [x, y] = arg.split(',').map(Number);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const clickCount of [1, 2]) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', x, y, clickCount });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', x, y, clickCount });
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`double-clicked ${x},${y}`);
} else if (action === 'drag') {
  // drag "x1,y1,x2,y2" — left-button drag (e.g. select text in the terminal)
  const [x1, y1, x2, y2] = arg.split(',').map(Number);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', x: x1, y: y1, clickCount: 1, buttons: 1 });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', x, y, buttons: 1 });
    await new Promise((r) => setTimeout(r, 30));
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', x: x2, y: y2, clickCount: 1 });
  console.log(`dragged ${x1},${y1} -> ${x2},${y2}`);
} else if (action === 'type') {
  // type "text" — per-char key events with text payloads (reaches xterm's
  // custom key handler AND inserts into a focused DOM input, like real typing)
  for (const ch of arg) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await new Promise((r) => setTimeout(r, 40));
  }
  console.log(`typed ${arg}`);
} else if (action === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(r.data, 'base64'));
  console.log('saved ' + arg);
} else {
  throw new Error('unknown action: ' + action);
}

ws.close();

import QRCode from 'qrcode';

const root = document.querySelector('#app');
const dialog = document.querySelector('#feedback-dialog');
const adminPage = location.pathname === '/admin';
const shareToken = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/)?.[1] ?? '';
let guide, role, activeTab = 'chat', busy = false, feedbackTarget = null, history = [], chatNodes = [];

const paw = '<svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="12" cy="12" rx="4" ry="5" transform="rotate(-25 12 12)"/><ellipse cx="22" cy="9" rx="4" ry="5"/><ellipse cx="31" cy="16" rx="4" ry="5" transform="rotate(25 31 16)"/><ellipse cx="6" cy="22" rx="3.5" ry="4.5" transform="rotate(-25 6 22)"/><path d="M12 27c1-6 5-10 10-9 5 0 8 6 8 11 0 6-5 6-9 4-4 2-11 2-9-6z"/></svg>';
const clean = text => text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function toast(message) { const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('visible'), 4000); }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || 'Something went wrong. Please try again.'); error.status = response.status; throw error; }
  return data;
}

function brand() { return `<a class="brand" href="${adminPage ? '/admin' : location.pathname}"><span class="brand-mark">${paw}</span><span>Mozz<span class="brand-light">AI</span></span></a>`; }

function showLogin(message = '') {
  root.innerHTML = `<header class="site-header">${brand()}<span class="pill">Family pilot</span></header><main class="login-layout"><section class="login-intro"><span class="eyebrow">A LITTLE HELP WITH CARE</span><h1>More knowing.<br>Less guessing.</h1><p>Routines, little quirks, and the answers you need—all in one thoughtful care companion.</p><div class="intro-art"><span class="art-paw">${paw}</span><span class="art-note note-one">Made for the little things.</span><span class="art-note note-two">And the important ones.</span></div></section><section class="login-card"><span class="eyebrow">${adminPage ? 'OWNER SPACE' : 'WELCOME, SITTER'}</span><h2>${adminPage ? 'Your feedback hub' : 'You’re in the right place.'}</h2><p class="muted">${adminPage ? 'Use the separate owner password to review feedback and manage the test link.' : 'Enter the access code shared with you to open Mozz’s care guide and AI assistant.'}</p><form id="login-form"><label for="access-code">${adminPage ? 'Owner password' : 'Access code'}</label><input id="access-code" type="password" autocomplete="${adminPage ? 'current-password' : 'one-time-code'}" required maxlength="256" placeholder="${adminPage ? 'Your owner password' : 'Your private access code'}"><p id="login-error" class="error" role="alert"></p><button class="button primary" type="submit">${adminPage ? 'Open feedback hub' : 'Open Mozz’s care space'} <span aria-hidden="true">↗</span></button></form><p class="fine-print">Private access · AI powered · Draft for testing</p></section></main><footer class="site-footer"><span>Thoughtful care starts with knowing.</span><a href="/admin">Owner access</a></footer>`;
  document.querySelector('#login-error').textContent = message;
  document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; button.textContent = 'Opening…';
    try { const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ role: adminPage ? 'admin' : 'sitter', password: document.querySelector('#access-code').value, shareToken }) }); role = result.role; await loadApp(); }
    catch (error) { document.querySelector('#login-error').textContent = error.message; button.disabled = false; button.textContent = 'Try again'; }
  });
}

async function loadApp() {
  if (adminPage && role === 'admin') return showAdmin();
  guide = await api('/api/guide');
  root.innerHTML = `<header class="site-header">${brand()}<div class="header-actions"><span class="pill">Private care space</span><button class="text-button" id="logout">Lock</button></div></header><div class="draft-banner"><strong>Draft · Testing only</strong><span>Some care details are still unconfirmed. Check the guide and contact an owner when needed.</span></div><main class="care-layout"><aside class="pet-sidebar"><div class="pet-avatar">${paw}</div><span class="eyebrow">MEET YOUR LITTLE COMPANION</span><h1>Mozz</h1><p class="muted">A care guide, a helpful assistant,<br>and a little peace of mind.</p><div class="sidebar-divider"></div><p class="small-label">THE ESSENTIALS COME FIRST</p><p class="sidebar-copy">The care guide is always here, even when the AI is unavailable.</p><button class="button secondary" id="essential-guide">Read the care guide ↗</button><button class="text-button sidebar-feedback" id="sidebar-feedback">Have feedback? We’re listening.</button></aside><section class="workspace"><nav class="tabs" aria-label="Care space"><button data-tab="chat" class="active">Ask about Mozz</button><button data-tab="guide">Care guide</button><button data-tab="feedback">Give feedback</button></nav><div id="workspace-content"></div></section></main><footer class="site-footer"><span>AI answers can be wrong. Important care decisions need confirmed instructions.</span><a href="/admin">Owner access</a></footer>`;
  document.querySelector('#logout').onclick = logout;
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => setTab(button.dataset.tab));
  document.querySelector('#essential-guide').onclick = () => setTab('guide');
  document.querySelector('#sidebar-feedback').onclick = () => openFeedback();
  setTab(activeTab);
}

function setTab(tab) {
  activeTab = tab; document.querySelectorAll('[data-tab]').forEach(button => { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false'); });
  const content = document.querySelector('#workspace-content'); content.replaceChildren();
  if (tab === 'guide') return renderGuide(content);
  if (tab === 'feedback') {
    content.innerHTML = '<div class="empty-state"><span class="eyebrow">BUILT WITH YOUR HELP</span><h2>What could be better?</h2><p>Tell us what felt useful, confusing, or missing. You can also rate individual AI answers directly in the chat.</p><button class="button primary" id="general-feedback">Share feedback ↗</button><p class="fine-print">Names are optional. Feedback is kept until an owner deletes it. Full chat history is not saved.</p></div>';
    document.querySelector('#general-feedback').onclick = () => openFeedback(); return;
  }
  content.innerHTML = '<div class="chat-heading"><div><span class="eyebrow">MOZZ’S AI CARE ASSISTANT</span><h2>A question? Start here.</h2></div><button class="text-button" id="new-chat">New chat</button></div><div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Conversation"></div><form class="composer" id="chat-form"><label class="sr-only" for="question">Your question about Mozz</label><textarea id="question" rows="2" maxlength="2000" placeholder="What would you like to know about Mozz?" required></textarea><button class="send-button" id="send-question" type="submit" aria-label="Send question">↑</button></form><p class="chat-privacy">AI powered · Based on the owner’s guide · Chats stay in this tab unless attached to feedback</p>';
  const log = document.querySelector('#chat-log');
  if (!chatNodes.length) {
    const welcome = element('div', 'welcome-message'); welcome.innerHTML = '<span class="welcome-paw">' + paw + '</span><h3>A little help, right when you need it.</h3><p>I can help you find Mozz’s routines and care instructions. If something is missing, I’ll say so.</p><div class="suggested-questions"></div>';
    for (const question of ['What should I feed Mozz?', 'Where should Mozz sleep?', 'What should I know before visitors arrive?']) {
      const button = element('button', 'question-chip', question); button.onclick = () => { document.querySelector('#question').value = question; document.querySelector('#chat-form').requestSubmit(); }; welcome.querySelector('.suggested-questions').append(button);
    }
    log.append(welcome);
  } else chatNodes.forEach(node => log.append(node));
  document.querySelector('#new-chat').onclick = () => { if (busy) return; history = []; chatNodes = []; setTab('chat'); };
  document.querySelector('#chat-form').onsubmit = sendQuestion;
  document.querySelector('#question').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } };
  document.querySelector('#send-question').disabled = busy;
}

function renderGuide(container) {
  const heading = element('div', 'guide-heading'); heading.innerHTML = '<span class="eyebrow">FROM THE OWNER</span><h2>The little details matter.</h2><p class="muted">Owner-reported instructions. Missing information is marked clearly.</p>'; container.append(heading);
  for (const section of guide.sections) {
    const card = element('section', 'guide-card'); card.id = 'source-' + section.id;
    card.append(element('span', 'section-tag ' + section.category, section.category === 'confirmed' ? 'Owner reported' : 'Needs confirmation'), element('h3', '', section.title));
    for (const line of section.content.split('\n')) {
      if (!line.trim() || /^\|[-| :]+\|$/.test(line)) continue;
      const paragraph = element('p', line.startsWith('- ') ? 'guide-bullet' : 'guide-line', clean(line.replace(/^- /, '').replace(/^\| | \|$/g, '').replace(/ \| /g, ' — '))); card.append(paragraph);
    }
    container.append(card);
  }
}

async function sendQuestion(event) {
  event.preventDefault(); if (busy) return;
  const input = document.querySelector('#question'), question = input.value.trim(); if (!question) return;
  busy = true; document.querySelector('#send-question').disabled = true; input.value = '';
  const log = document.querySelector('#chat-log'); if (!chatNodes.length) log.replaceChildren();
  const user = element('div', 'message user-message', question); chatNodes.push(user); log.append(user);
  const pending = element('div', 'message pending-message', 'Checking Mozz’s guide…'); log.append(pending); pending.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  try {
    const messages = [...history.slice(-6), { role: 'user', content: question }];
    const answer = await api('/api/chat', { method: 'POST', body: JSON.stringify({ messages }) });
    const response = element('div', 'message assistant-message'); response.append(element('span', 'answer-label', answer.type === 'suggestion' ? 'Suggestion based on the guide' : answer.type === 'clarify' ? 'Some information needs confirmation' : 'From the care guide'), element('p', 'answer-text', answer.answer));
    const sources = element('div', 'sources');
    for (const id of answer.sources) { const section = guide.sections.find(s => s.id === id); const button = element('button', 'source-chip', section?.title ?? id); button.onclick = () => { setTab('guide'); document.getElementById('source-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }; sources.append(button); }
    response.append(sources);
    const ratings = element('div', 'answer-feedback'); ratings.append(element('span', '', 'Was this useful?'));
    for (const [rating, label] of [['helpful', 'Yes'], ['unhelpful', 'Not quite']]) { const button = element('button', 'text-button', label); button.onclick = () => openFeedback({ receipt: answer.receipt, rating }); ratings.append(button); }
    response.append(ratings); chatNodes.push(response); history.push({ role: 'user', content: question }, { role: 'assistant', content: answer.answer });
    if (activeTab === 'chat') { pending.replaceWith(response); response.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  } catch (error) {
    const node = element('div', 'message chat-error', error.message); chatNodes.push(node); if (activeTab === 'chat') pending.replaceWith(node);
    if (error.status === 401) { history = []; chatNodes = []; showLogin(error.message); }
  } finally { busy = false; const button = document.querySelector('#send-question'); if (button) button.disabled = false; }
}

function openFeedback(target = null) {
  feedbackTarget = target; document.querySelector('#feedback-form').reset(); document.querySelector('#feedback-error').textContent = '';
  document.querySelector('#feedback-context').textContent = target ? 'Your selected question and answer will be included. Your other chat messages will not be saved.' : 'This sends your feedback without attaching chat messages.';
  document.querySelector('#feedback-category').disabled = !!target; dialog.showModal();
}
document.querySelector('#close-feedback').onclick = () => dialog.close();
document.querySelector('#feedback-form').onsubmit = async event => {
  event.preventDefault(); const button = document.querySelector('#save-feedback'); button.disabled = true;
  try { await api('/api/feedback', { method: 'POST', body: JSON.stringify({ category: feedbackTarget ? 'rating' : document.querySelector('#feedback-category').value, comment: document.querySelector('#feedback-comment').value, testerName: document.querySelector('#tester-name').value, ...feedbackTarget }) }); dialog.close(); toast('Thank you—your feedback has been saved.'); }
  catch (error) { document.querySelector('#feedback-error').textContent = error.message; }
  finally { button.disabled = false; }
};

async function showAdmin() {
  root.innerHTML = `<header class="site-header">${brand()}<div class="header-actions"><span class="pill">Owner space</span><button class="text-button" id="logout">Sign out</button></div></header><main class="admin-layout"><div class="section-heading"><div><span class="eyebrow">LEARN FROM THE PILOT</span><h1>Your feedback hub</h1><p class="muted">Only submitted feedback is saved. Full chat histories are not stored.</p></div><a href="/api/admin/export" class="button secondary">Export CSV ↗</a></div><section class="share-card"><div><h2>Invite a fresh pair of eyes.</h2><p>Share this link or QR code, and send the sitter access code separately.</p><div class="share-link"><input id="share-url" readonly aria-label="Private tester link"><button class="button secondary" id="copy-link">Copy link</button></div></div><canvas id="qr-code" aria-label="QR code for the private tester link"></canvas></section><div class="section-heading"><h2>Tester feedback</h2><button class="text-button danger" id="delete-all">Delete all feedback</button></div><p class="fine-print">Feedback is retained until an owner deletes it. The dashboard shows the latest 500 items; CSV includes all saved items.</p><div id="feedback-list" aria-live="polite"></div></main>`;
  document.querySelector('#logout').onclick = logout;
  const share = await api('/api/admin/share'); document.querySelector('#share-url').value = share.url;
  await QRCode.toCanvas(document.querySelector('#qr-code'), share.url, { width: 156, margin: 2, color: { dark: '#233e32', light: '#ffffff' } });
  document.querySelector('#copy-link').onclick = async () => { try { await navigator.clipboard.writeText(share.url); toast('Tester link copied.'); } catch { document.querySelector('#share-url').select(); toast('Select and copy the tester link.'); } };
  document.querySelector('#delete-all').onclick = async () => { if (!confirm('Permanently delete all saved feedback?')) return; try { await api('/api/admin/feedback', { method: 'DELETE', body: JSON.stringify({ confirm: 'delete-all' }) }); await refreshFeedback(); } catch (error) { toast(error.message); } };
  await refreshFeedback();
}

async function refreshFeedback() {
  const list = document.querySelector('#feedback-list'); const { items } = await api('/api/admin/feedback'); list.replaceChildren();
  if (!items.length) { list.append(element('div', 'admin-empty', 'A little quiet here. Feedback will appear after a tester submits it.')); return; }
  for (const item of items) {
    const card = element('article', 'feedback-card'); const heading = element('div', 'section-heading');
    heading.append(element('strong', '', [item.category, item.rating].filter(Boolean).join(' · ')));
    const remove = element('button', 'text-button danger', 'Delete'); remove.onclick = async () => { if (!confirm('Permanently delete this feedback?')) return; try { await api('/api/admin/feedback/' + item.id, { method: 'DELETE' }); await refreshFeedback(); } catch (error) { toast(error.message); } }; heading.append(remove); card.append(heading);
    card.append(element('p', 'fine-print', `${item.tester_name || 'Anonymous'} · ${new Date(item.created_at).toLocaleString()}`));
    if (item.comment) card.append(element('p', 'answer-text', item.comment));
    if (item.question) { const attached = element('div', 'attached-exchange'); attached.append(element('strong', '', 'Attached question'), element('p', '', item.question), element('strong', '', 'AI answer'), element('p', 'answer-text', item.answer), element('p', 'fine-print', `${item.answer_type} · ${item.model} · guide ${item.guide_version}`)); card.append(attached); }
    list.append(card);
  }
}

async function logout() { await api('/api/logout', { method: 'POST', body: '{}' }); history = []; chatNodes = []; guide = undefined; role = undefined; showLogin(); }

async function init() {
  if (!adminPage && !shareToken) { root.innerHTML = `<header class="site-header">${brand()}</header><main class="empty-state"><h1>A private space for thoughtful care.</h1><p>Open the full link shared by an owner to get started.</p><a href="/admin" class="button secondary">Owner access</a></main>`; return; }
  try { const current = await api('/api/session'); role = current.role; if (adminPage && role !== 'admin') showLogin(); else await loadApp(); }
  catch { showLogin(); }
}
init().catch(() => showLogin('The app could not load. Please try again.'));

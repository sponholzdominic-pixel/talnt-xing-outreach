// ─── talnt. XING Outreach — Background Service Worker v5 (Sequenzen) ─────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = {
  get: k => new Promise(r => chrome.storage.local.get(k, d => r(d[k]))),
  set: (k,v) => new Promise(r => chrome.storage.local.set({[k]:v}, r)),
};

async function addLog(msg, type = 'info') {
  const logs = await S.get('logs') || [];
  const t = new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  logs.unshift({msg, type, time: t});
  if (logs.length > 300) logs.splice(300);
  await S.set('logs', logs);
}

function fillTemplate(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || '');
}

function waitForTabLoad(tabId, maxMs = 15000) {
  return new Promise(resolve => {
    const fn = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(fn);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(fn);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(false); }, maxMs);
  });
}

async function sendOneMessage(tabId, message, subject) {
  // Try content script first
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'FILL_AND_SEND', message, subject,
    });
    if (result) return result;
  } catch (e) {
    console.log('[talnt.] sendMessage failed:', e.message);
  }
  return { ok: false, error: 'Content script nicht erreichbar' };
}

function buildVars(candidate, camp) {
  return {
    vorname:  candidate.firstName || (candidate.name||'').split(' ')[0] || '',
    nachname: candidate.lastName  || (candidate.name||'').split(' ').slice(1).join(' ') || '',
    position: candidate.jobTitle  || camp.defaultVars?.position || '',
    region:   candidate.location  || camp.defaultVars?.region   || '',
    firma:    candidate.company   || '',
    ...(camp.defaultVars || {}),
  };
}


// ── Background window management ──────────────────────────────────────────────
let backgroundWindowId = null;

async function getOrCreateBackgroundWindow() {
  // Check if existing window is still open
  if (backgroundWindowId !== null) {
    try {
      const win = await chrome.windows.get(backgroundWindowId);
      if (win) return win;
    } catch {}
  }

  // Create new small window positioned off to the side
  const win = await chrome.windows.create({
    url: 'https://www.xing.com',
    type: 'normal',
    width: 1024,
    height: 768,
    left: 50,
    top: 50,
    focused: false,
  });

  backgroundWindowId = win.id;
  await addLog('Hintergrundfenster geöffnet (bitte nicht schließen)', 'info');
  await sleep(3000); // wait for window to be ready
  return win;
}

// Clean up reference if window is closed
chrome.windows.onRemoved.addListener(windowId => {
  if (windowId === backgroundWindowId) {
    backgroundWindowId = null;
  }
});

// ── Send messages for one sequence step ───────────────────────────────────────
async function runStep(campId, stepIndex) {
  let campaigns = await S.get('campaigns') || [];
  const templates = await S.get('templates') || [];
  const sequences = await S.get('sequences') || [];

  const camp = campaigns.find(c => c.id === campId);
  if (!camp || camp.status === 'paused') return;

  const seq = sequences.find(s => s.id === camp.sequenceId);
  if (!seq) { await addLog('Sequenz nicht gefunden', 'err'); return; }

  const step = seq.steps[stepIndex];
  if (!step) { await addLog('Schritt nicht gefunden', 'err'); return; }

  const tpl = templates.find(t => t.id === step.templateId);
  if (!tpl) { await addLog(`Kein Template für Schritt ${stepIndex+1}`, 'err'); return; }

  // Find candidates due for this step
  const due = camp.candidates.filter(c => {
    if (c.optedOut) return false;
    const st = (c.steps || {})[stepIndex];
    if (st === 'sent' || st === 'skipped' || st === 'sending') return false;
    if (stepIndex === 0) return !st || st === 'pending'; // only if not yet sent
    // Follow-up: previous step must be sent AND delay passed
    const prevSentAt = (c.steps || {})[`${stepIndex-1}_sentAt`];
    if (!prevSentAt) return false;
    const delayMs = (step.delayDays || 3) * 24 * 60 * 60 * 1000;
    return (Date.now() - prevSentAt) >= delayMs;
  });

  if (!due.length) {
    await addLog(`Schritt ${stepIndex+1}: keine fälligen Kandidaten`, 'info');
    return;
  }

  await addLog(`Schritt ${stepIndex+1} — ${due.length} Kandidaten`, 'info');

  for (let i = 0; i < due.length; i++) {
    // Re-check pause
    campaigns = await S.get('campaigns') || [];
    if (campaigns.find(c => c.id === campId)?.status === 'paused') {
      await addLog('Pausiert', 'info'); return;
    }

    const candidate = due[i];
    const vars = buildVars(candidate, camp);
    const message = fillTemplate(tpl.body, vars);
    const subject = fillTemplate(tpl.subject, vars);

    await addLog(`(${i+1}/${due.length}) ${candidate.name} — Schritt ${stepIndex+1}`, 'info');

    // Double-check status right before marking — race condition guard
    const latestCamps = await S.get('campaigns') || [];
    const latestCamp = latestCamps.find(cc => cc.id === campId);
    const latestCand = latestCamp?.candidates?.find(c => c.name === candidate.name && c.profileUrl === candidate.profileUrl);
    const latestSt = (latestCand?.steps||{})[stepIndex];
    if (latestSt === 'sent' || latestSt === 'sending') {
      await addLog(`[Guard] ${candidate.name} Schritt ${stepIndex+1} bereits gesendet — überspringe`, 'info');
      continue;
    }

    // Mark step as 'sending' to prevent duplicate on restart
    {
      const cc = await S.get('campaigns') || [];
      const ci2 = cc.findIndex(x => x.id === campId);
      if (ci2 !== -1) {
        const xi2 = cc[ci2].candidates.findIndex(x => x.id === candidate.id);
        if (xi2 !== -1) {
          if (!cc[ci2].candidates[xi2].steps) cc[ci2].candidates[xi2].steps = {};
          cc[ci2].candidates[xi2].steps[stepIndex] = 'sending';
        }
        await S.set('campaigns', cc);
      }
    }

    let tab = null;
    let ok = false;
    let errorMsg = '';

    try {
      // Open in dedicated background window
      const win = await getOrCreateBackgroundWindow();
      tab = await chrome.tabs.create({ url: candidate.profileUrl, windowId: win.id, active: false });
      await waitForTabLoad(tab.id, 15000);
      await sleep(5000);

      let result;
      try {
        result = await sendOneMessage(tab.id, message, subject);
      } catch (e) {
        await waitForTabLoad(tab.id, 8000);
        await sleep(3000);
        try { result = await sendOneMessage(tab.id, message, subject); }
        catch (e2) { result = { ok: false, error: e2.message }; }
      }
      ok = result?.ok || false;
      errorMsg = result?.error || '';
    } catch (e) {
      errorMsg = e.message;
    } finally {
      await sleep(3000);
      if (tab) { try { await chrome.tabs.remove(tab.id); } catch {} }
    }

    // Save result
    campaigns = await S.get('campaigns') || [];
    const ci = campaigns.findIndex(c => c.id === campId);
    if (ci !== -1) {
      let xi = campaigns[ci].candidates.findIndex(x => x.id && x.id === candidate.id);
      if (xi === -1) xi = campaigns[ci].candidates.findIndex(x => x.name === candidate.name && x.profileUrl === candidate.profileUrl);
      if (xi !== -1) {
        if (!campaigns[ci].candidates[xi].steps) campaigns[ci].candidates[xi].steps = {};
        campaigns[ci].candidates[xi].steps[stepIndex] = ok ? 'sent' : 'failed';
        campaigns[ci].candidates[xi].steps[`${stepIndex}_sentAt`] = Date.now();
        campaigns[ci].candidates[xi].steps[`${stepIndex}_error`] = errorMsg || null;
      }
      await S.set('campaigns', campaigns);
    }

    // Track contact history
    if (ok) {
      const myName = await S.get('my_name') || 'Unbekannt';
      const history = await S.get('contact_history') || {};
      const burl = (candidate.profileBaseUrl || candidate.profileUrl || '').split('?')[0];
      if (burl) {
        history[burl] = { lastContacted: Date.now(), by: myName, count: (history[burl]?.count || 0) + 1, name: candidate.name };
        await S.set('contact_history', history);
      }
    }

    await addLog(ok ? `✓ Gesendet: ${candidate.name}` : `✗ ${candidate.name}: ${errorMsg}`, ok ? 'ok' : 'err');

    if (i < due.length - 1) {
      const d = 12000 + Math.random() * 8000;
      await addLog(`Warte ${Math.round(d/1000)}s...`, 'info');
      await sleep(d);
    }
  }

  await addLog(`Schritt ${stepIndex+1} abgeschlossen ✓`, 'ok');
}


// ── Fallback: direct campaign without sequence (backwards compatible) ──────────
async function runDirectCampaign(campId) {
  let campaigns = await S.get('campaigns') || [];
  const templates = await S.get('templates') || [];
  const camp = campaigns.find(c => c.id === campId);
  if (!camp) { await addLog('Kampagne nicht gefunden', 'err'); return; }

  const tpl = templates.find(t => t.id === camp.templateId);
  if (!tpl) { await addLog('Template nicht gefunden', 'err'); return; }

  const pending = camp.candidates.filter(c => c.status === 'pending' && c.status !== 'sent' && c.status !== 'sending');
  await addLog(`Kampagne "${camp.name}" — ${pending.length} Kandidaten`, 'info');

  for (let i = 0; i < pending.length; i++) {
    campaigns = await S.get('campaigns') || [];
    if (campaigns.find(c => c.id === campId)?.status === 'paused') { await addLog('Pausiert', 'info'); return; }

    const candidate = pending[i];
    const vars = buildVars(candidate, camp);
    const message = fillTemplate(tpl.body, vars);
    const subject = fillTemplate(tpl.subject, vars);

    await addLog(`(${i+1}/${pending.length}) ${candidate.name}`, 'info');

    // Mark as 'sending' immediately to prevent duplicate sends on restart
    {
      const cc = await S.get('campaigns') || [];
      const ci2 = cc.findIndex(x => x.id === campId);
      if (ci2 !== -1) {
        const xi2 = cc[ci2].candidates.findIndex(x => x.id === candidate.id);
        if (xi2 !== -1) cc[ci2].candidates[xi2].status = 'sending';
        await S.set('campaigns', cc);
      }
    }

    let tab = null, ok = false, errorMsg = '';
    try {
      // Open in dedicated background window
      const win = await getOrCreateBackgroundWindow();
      tab = await chrome.tabs.create({ url: candidate.profileUrl, windowId: win.id, active: false });
      await waitForTabLoad(tab.id, 15000);
      await sleep(5000);
      let result;
      try { result = await sendOneMessage(tab.id, message, subject); }
      catch (e) { await sleep(3000); try { result = await sendOneMessage(tab.id, message, subject); } catch(e2){ result={ok:false,error:e2.message}; } }
      ok = result?.ok||false; errorMsg = result?.error||'';
    } catch(e) { errorMsg = e.message; }
    finally { await sleep(3000); if(tab){ try{await chrome.tabs.remove(tab.id);}catch{} } }

    campaigns = await S.get('campaigns')||[];
    const ci = campaigns.findIndex(c=>c.id===campId);
    if(ci!==-1){
      // Find by id first, fallback to name+profileUrl
      let xi = campaigns[ci].candidates.findIndex(x=>x.id && x.id===candidate.id);
      if(xi===-1) xi = campaigns[ci].candidates.findIndex(x=>x.name===candidate.name && x.profileUrl===candidate.profileUrl);
      if(xi!==-1){
        campaigns[ci].candidates[xi].status=ok?'sent':'failed';
        campaigns[ci].candidates[xi].sentAt=Date.now();
        // Set steps[0] so follow-ups can find sentAt
        if(!campaigns[ci].candidates[xi].steps) campaigns[ci].candidates[xi].steps={};
        campaigns[ci].candidates[xi].steps[0] = ok?'sent':'failed';
        campaigns[ci].candidates[xi].steps['0_sentAt'] = Date.now();
      }
      await S.set('campaigns',campaigns);
    }
    if(ok){ const myName=await S.get('my_name')||'Unbekannt'; const history=await S.get('contact_history')||{}; const burl=(candidate.profileBaseUrl||candidate.profileUrl||'').split('?')[0]; if(burl){history[burl]={lastContacted:Date.now(),by:myName,count:(history[burl]?.count||0)+1,name:candidate.name}; await S.set('contact_history',history);} }
    await addLog(ok?`✓ Gesendet: ${candidate.name}`:`✗ ${candidate.name}: ${errorMsg}`, ok?'ok':'err');
    if(i<pending.length-1){ const d=12000+Math.random()*8000; await addLog(`Warte ${Math.round(d/1000)}s...`,'info'); await sleep(d); }
  }

  campaigns = await S.get('campaigns')||[];
  const fi=campaigns.findIndex(c=>c.id===campId);
  if(fi!==-1){ campaigns[fi].status='completed'; await S.set('campaigns',campaigns); }
  await addLog('🎉 Kampagne abgeschlossen!','ok');
}

// ── Scheduler — runs every minute, checks for due steps ───────────────────────
async function checkSchedule() {
  // Global lock — verhindert parallele Ausführung
  if (_schedulerRunning) {
    console.log('[talnt] Scheduler bereits aktiv — überspringe');
    return;
  }
  _schedulerRunning = true;

  try {
    const campaigns = await S.get('campaigns') || [];
    const sequences = await S.get('sequences') || [];

    for (const camp of campaigns) {
      if (camp.status !== 'running') continue;
      const seq = sequences.find(s => s.id === camp.sequenceId);
      if (!seq) continue;

      for (let si = 0; si < seq.steps.length; si++) {
        const step = seq.steps[si];

        // Reload campaigns fresh before each step to get latest status
        const freshCamps = await S.get('campaigns') || [];
        const freshCamp = freshCamps.find(c => c.id === camp.id);
        if (!freshCamp || freshCamp.status !== 'running') break;

        const hasDue = freshCamp.candidates?.some(c => {
          if (c.optedOut) return false;
          const st = (c.steps||{})[si];
          if (st === 'sent' || st === 'skipped' || st === 'sending') return false;
          if (si === 0) return !st || st === 'pending';
          const prevSentAt = (c.steps||{})[`${si-1}_sentAt`];
          if (!prevSentAt) return false;
          const delayMs = (step.delayDays||3) * 24 * 60 * 60 * 1000;
          return (Date.now() - prevSentAt) >= delayMs;
        });

        if (hasDue) {
          await addLog(`Scheduler: Schritt ${si+1} fällig — "${camp.name}"`, 'info');
          await runStep(camp.id, si);
        }
      }
    }
  } catch(e) {
    console.error('[talnt] Scheduler Fehler:', e);
  } finally {
    _schedulerRunning = false;
  }
}


// ── Auto-Update Check ─────────────────────────────────────────────────────────
const CURRENT_VERSION = '5.1.0';
const UPDATE_CHECK_URL = 'https://deinname.github.io/talnt-xing-outreach/updates.xml';

async function checkForUpdates() {
  try {
    const lastCheck = await S.get('last_update_check') || 0;
    // Check max once per day
    if (Date.now() - lastCheck < 24 * 60 * 60 * 1000) return;
    await S.set('last_update_check', Date.now());

    const res = await fetch(UPDATE_CHECK_URL + '?v=' + Date.now());
    const text = await res.text();
    const match = text.match(/version='([^']+)'/);
    if (!match) return;
    const latestVersion = match[1];

    if (latestVersion !== CURRENT_VERSION) {
      await S.set('update_available', latestVersion);
      console.log('[talnt] Update verfügbar:', latestVersion);
    } else {
      await S.set('update_available', null);
    }
  } catch(e) {
    console.log('[talnt] Update-Check fehlgeschlagen:', e.message);
  }
}

// Check on startup and daily
checkForUpdates();
chrome.alarms.create('update_check', { periodInMinutes: 60 * 24 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'update_check') checkForUpdates();
});

// Run scheduler every minute
chrome.alarms.create('scheduler', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'scheduler') checkSchedule();
});

// ── Messages from popup ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_CAMPAIGN') {
    (async () => {
      const camps = await S.get('campaigns') || [];
      const sequences = await S.get('sequences') || [];
      const idx = camps.findIndex(c => c.id === msg.campId);

      // Guard: don't start if already running
      if (camps[idx]?.status === 'running') {
        await addLog('Kampagne läuft bereits', 'info');
        return;
      }

      if (idx !== -1) {
        camps[idx].status = 'running';
        camps[idx].candidates.forEach(c => {
          if (!c.steps) c.steps = {};
          // Only mark step 0 as pending if never attempted
          if (!c.steps[0]) c.steps[0] = 'pending';
        });
        await S.set('campaigns', camps);
      }

      const camp = camps[idx];
      const seq = sequences.find(s => s.id === camp?.sequenceId);

      if (seq) {
        await addLog('Starte Sequenz: ' + seq.name, 'info');
        await runStep(msg.campId, 0);
      } else {
        await addLog('Starte direkt (keine Sequenz)', 'info');
        await runDirectCampaign(msg.campId);
      }
    })();
    sendResponse({ ok: true });
  }

  if (msg.type === 'PAUSE_CAMPAIGN') {
    (async () => {
      const camps = await S.get('campaigns') || [];
      const idx = camps.findIndex(c => c.id === msg.campId);
      if (idx !== -1) { camps[idx].status = 'paused'; await S.set('campaigns', camps); }
    })();
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_BG_WINDOW') {
    (async () => {
      try {
        const win = await getOrCreateBackgroundWindow();
        sendResponse({ windowId: win.id });
      } catch(e) {
        sendResponse({ windowId: null });
      }
    })();
    return true;
  }

  if (msg.type === 'OPT_OUT') {
    (async () => {
      const camps = await S.get('campaigns') || [];
      for (const camp of camps) {
        const ci = camp.candidates?.findIndex(c => c.id === msg.candidateId);
        if (ci !== -1) camp.candidates[ci].optedOut = true;
      }
      await S.set('campaigns', camps);
      await addLog('Opt-out: ' + msg.name, 'info');
    })();
    sendResponse({ ok: true });
  }

  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('scheduler', { periodInMinutes: 1 });
  console.log('[talnt.] v5 Sequenzen ready');
});

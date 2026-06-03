// ── Supabase Config ───────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://wvcjcjpulktryagwbwkb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2Y2pjanB1bGt0cnlhZ3did2tiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0Nzk1NTAsImV4cCI6MjA5NjA1NTU1MH0.6cqY_s0X-ymSD_F_xlwd2kmxVflBOsI02hj9lJImC2M';

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkAuth() {
  const session = await S.get('supabase_session');
  if (session && session.access_token) {
    // Check expiry - expires_at is Unix timestamp in seconds
    const now = Math.floor(Date.now() / 1000);
    if (!session.expires_at || session.expires_at > now) {
      showApp();
      return;
    }
  }
  showLogin();
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
}

async function login(email, password) {
  const btn = $('btn-login');
  btn.disabled = true; btn.textContent = '⏳ Anmelden...';
  $('login-error').textContent = '';
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Login fehlgeschlagen');
    // Store session — expires_at is Unix timestamp in seconds
    // Default to 30 days if not provided
    const expiresAt = data.expires_at || (Math.floor(Date.now()/1000) + 30*24*60*60);
    await S.set('supabase_session', {
      access_token: data.access_token,
      expires_at: expiresAt,
      user: { email: data.user?.email, id: data.user?.id }
    });
    showApp();
    await initApp();
  } catch(e) {
    $('login-error').textContent = e.message;
  }
  btn.disabled = false; btn.textContent = 'Anmelden';
}

document.getElementById('btn-login').addEventListener('click', () => {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email || !password) { $('login-error').textContent = 'Bitte E-Mail und Passwort eingeben'; return; }
  login(email, password);
});

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    if (email && password) login(email, password);
  }
});

// Show login immediately while checking session
document.getElementById('login-screen').style.display = 'flex';

// ─── talnt. XING Outreach Manager — Popup v2 ─────────────────────────────────

// ── Default Templates ──────────────────────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  {
    id: 'tpl_tga',
    name: 'Erstkontakt – TGA / HVAC',
    type: 'cold',
    subject: 'Spannende Karrierechance im TGA-Bereich',
    body: `Hallo {{vorname}},

ich bin auf Ihr Profil aufmerksam geworden und war beeindruckt von Ihrer Erfahrung im Bereich {{position}}.

Für ein renommiertes Unternehmen in {{region}} suchen wir aktuell eine/n {{position}}. Die Stelle bietet attraktive Konditionen und sehr gute Entwicklungsmöglichkeiten.

Hätten Sie kurz Zeit für ein unverbindliches Gespräch?

Mit freundlichen Grüßen,
Dominic Sponholz
talnt. GmbH`,
  },
  {
    id: 'tpl_tax',
    name: 'Erstkontakt – Tax / Audit',
    type: 'cold',
    subject: 'Interessante Position im Steuer-/Prüfungswesen',
    body: `Hallo {{vorname}},

Ihr Profil ist mir bei meiner Recherche nach erfahrenen Fachkräften im Bereich {{position}} aufgefallen.

Im Auftrag einer Kanzlei in {{region}} bin ich auf der Suche nach einem/einer {{position}}. Das Unternehmen zeichnet sich durch ein modernes Arbeitsumfeld und flache Hierarchien aus.

Wären Sie offen für einen kurzen Austausch?

Beste Grüße,
Dominic Sponholz
talnt. GmbH`,
  },
  {
    id: 'tpl_followup',
    name: 'Follow-up – kein Feedback',
    type: 'followup',
    subject: 'Kurze Nachfrage zu meiner letzten Nachricht',
    body: `Hallo {{vorname}},

ich melde mich noch einmal kurz bezüglich meiner Nachricht von letzter Woche.

Die Position als {{position}} in {{region}} ist weiterhin offen. Falls Sie Interesse haben oder Fragen aufgekommen sind, stehe ich gerne zur Verfügung.

Kein Druck – ich freue mich einfach über eine kurze Rückmeldung.

Beste Grüße,
Dominic Sponholz
talnt. GmbH`,
  },
];

// ── Storage ────────────────────────────────────────────────────────────────────
const S = {
  get: k => new Promise(r => chrome.storage.local.get(k, d => r(d[k]))),
  set: (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r)),
};

// ── State ──────────────────────────────────────────────────────────────────────
let templates = [];
let campaigns = [];
let logs = [];
let pendingCandidates = [];
let editingTplId = null;

// ── Helpers ────────────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const $ = id => document.getElementById(id);
const now = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let toastT;
function toast(msg, type = 'ok') {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.background = type === 'ok' ? '#064e3b' : '#450a0a';
  el.style.border = `1px solid ${type === 'ok' ? '#10b981' : '#7f1d1d'}`;
  el.style.color = type === 'ok' ? '#6ee7b7' : '#fca5a5';
  clearTimeout(toastT);
  toastT = setTimeout(() => el.style.display = 'none', 2800);
}

async function addLog(msg, type = 'info') {
  logs.unshift({ msg, type, time: now() });
  if (logs.length > 200) logs = logs.slice(0, 200);
  await S.set('logs', logs);
  renderLog();
}

function renderLog() {
  const box = $('log-box');
  if (!logs.length) { box.innerHTML = '<div class="log-line" style="color:#334155">Noch keine Einträge.</div>'; return; }
  box.innerHTML = logs.map(l =>
    `<div class="log-line ${l.type}"><span class="log-time">${l.time}</span><span>${esc(l.msg)}</span></div>`
  ).join('');
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
let _seqBound = false, _settingsBound = false;
function initTabs() {
  // Gear icon opens settings
  const gearBtn = $('btn-settings-gear');
  if (gearBtn) {
    gearBtn.addEventListener('click', () => {
      const settingsTab = $('tab-settings');
      if (!settingsTab) return;
      const isOpen = !settingsTab.classList.contains('hidden');
      if (isOpen) {
        // Close — restore last active tab
        settingsTab.classList.add('hidden');
        const activeTab = document.querySelector('.tab.active');
        if (activeTab) $(`tab-${activeTab.dataset.tab}`)?.classList.remove('hidden');
      } else {
        document.querySelectorAll('[id^="tab-"]').forEach(c => c.classList.add('hidden'));
        settingsTab.classList.remove('hidden');
        // Bind settings on first open
        if (!_settingsBound) {
          _settingsBound = true;
          S.get('my_name').then(name => { if(name && $('in-my-name')) $('in-my-name').value = name; });
          const saveName = $('btn-save-name');
          if(saveName) saveName.addEventListener('click', async () => {
            const name = $('in-my-name').value.trim();
            if(!name){toast('Bitte Namen eingeben','err');return;}
            myName = name;
            await S.set('my_name', name);
            toast('Name gespeichert ✓');
          });
          const importBtn = $('btn-import-xing-history');
          if(importBtn) importBtn.addEventListener('click', importXingHistory);
        }
      }
      gearBtn.style.color = settingsTab.classList.contains('hidden') ? 'var(--text3)' : 'var(--accent)';
    });
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('[id^="tab-"]').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.remove('hidden');

      if (tab.dataset.tab === 'dash') {
        renderDashboard();
        setTimeout(() => {
          const exportBtn = $('btn-export-report');
          if (exportBtn && !exportBtn._bound) {
            exportBtn._bound = true;
            exportBtn.addEventListener('click', exportReport);
          }
        }, 100);
      }

      if (tab.dataset.tab === 'seq' && !_seqBound) {
        _seqBound = true;
        $('btn-new-seq').addEventListener('click', () => showSeqForm(null));
        $('btn-save-seq').addEventListener('click', saveSequence);
        $('btn-cancel-seq').addEventListener('click', hideSeqForm);
        $('btn-add-step').addEventListener('click', () => {
          seqSteps.push({label:`Follow-up ${seqSteps.length}`, templateId:'', delayDays:3});
          renderSeqBuilder();
        });
        renderSequences();
      }

      if (tab.dataset.tab === 'history') {
        renderHistory();
        bindHistoryTab();
      }


    });
  });
}

// ── Campaigns ──────────────────────────────────────────────────────────────────



// ── Export Report as DOCX ─────────────────────────────────────────────────────
async function exportReport() {
  const btn = $('btn-export-report');
  btn.disabled = true; btn.textContent = '⏳ Erstelle Report...';

  try {
    const history = await S.get('contact_history') || {};
    const now = Date.now();
    const d30 = 30 * 24 * 60 * 60 * 1000;
    const today = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });

    // Calc totals
    let totalSent = 0, totalFailed = 0, totalCandidates = 0;
    const campData = campaigns.map(c => {
      let sent = 0, failed = 0;
      (c.candidates || []).forEach(cand => {
        totalCandidates++;
        const steps = cand.steps || {};
        let candSent = false, candFailed = false;
        Object.keys(steps).forEach(k => {
          if (!isNaN(k)) {
            if (steps[k] === 'sent') candSent = true;
            if (steps[k] === 'failed') candFailed = true;
          }
        });
        if (cand.status === 'sent' || candSent) { sent++; totalSent++; }
        else if (cand.status === 'failed' || candFailed) { failed++; totalFailed++; }
      });
      const total = c.candidates?.length || 0;
      const seq = sequences.find(s => s.id === c.sequenceId);
      return { name: c.name, total, sent, failed, pending: total - sent - failed, seq: seq?.name || '—', status: c.status || 'draft' };
    });

    // History last 30 days
    const recent = Object.values(history).filter(h => now - h.lastContacted < d30).length;

    // Build docx using window.docx if available
    if (!window.docx) {
      // Fallback: plain text download
      const lines = [
        'talnt. XING Outreach - Report',
        'Erstellt am: ' + today + '  |  Zeitraum: Letzte 30 Tage',
        '-'.repeat(50),
        '',
        'GESAMT-UEBERSICHT',
        '  Nachrichten gesendet : ' + totalSent,
        '  Fehler               : ' + totalFailed,
        '  Kandidaten gesamt    : ' + totalCandidates,
        '  Kontakte (30 Tage)   : ' + recent,
        '',
        'NACH KAMPAGNE',
        'Kampagne                            Gesend.  Fehler  Aussteh.',
        '-'.repeat(60),
      ].concat(campData.map(c =>
        (c.name.slice(0,34) + '                                   ').slice(0,35) +
        String(c.sent).padStart(6) + '  ' +
        String(c.failed).padStart(6) + '  ' +
        String(c.pending).padStart(8)
      )).concat(['', '-'.repeat(50), 'talnt. GmbH - Recruiting Automation - XING Outreach Manager']);
      const txt = lines.join('\n') + '\n';
      const blob = new Blob([txt], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `talnt-report-${today.replace(/\./g,'-')}.txt`;
      a.click(); URL.revokeObjectURL(url);
      toast('Report als TXT exportiert ✓');
      return;
    }

    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel, LevelFormat } = window.docx;

    const purple = '7C3AED', dark = '0F172A', grey = '475569', light = 'F8FAFC';
    const b = { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' };
    const borders = { top:b, bottom:b, left:b, right:b };

    const cell = (text, fill, w, bold=false, color=dark, size=20) =>
      new TableCell({ borders, width:{size:w,type:WidthType.DXA}, shading:{fill,type:ShadingType.CLEAR},
        margins:{top:80,bottom:80,left:120,right:80},
        children:[new Paragraph({children:[new TextRun({text,size,font:'Arial',color,bold})]})] });

    const hrow = (cols, widths) => new TableRow({ children: cols.map((t,i) => cell(t, purple, widths[i], true, 'FFFFFF', 20)) });
    const drow = (cols, widths, i) => new TableRow({ children: cols.map((t,j) => cell(t, i%2===0?light:'FFFFFF', widths[j])) });

    const doc = new Document({
      sections:[{ properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},
        children:[
          // Title
          new Paragraph({ spacing:{before:0,after:200}, children:[
            new TextRun({text:'talnt. XING Outreach — Report', bold:true, size:36, color:purple, font:'Arial'}),
          ]}),
          new Paragraph({ spacing:{before:0,after:400}, children:[
            new TextRun({text:`Erstellt am: ${today}  ·  Zeitraum: Letzte 30 Tage`, size:20, color:grey, font:'Arial'}),
          ]}),

          // Totals table
          new Paragraph({ spacing:{before:0,after:120}, children:[new TextRun({text:'Gesamtübersicht', bold:true, size:26, color:dark, font:'Arial'})] }),
          new Table({ width:{size:9026,type:WidthType.DXA}, columnWidths:[5000,2013,2013],
            rows:[
              hrow(['Kennzahl','Wert','Info'],[5000,2013,2013]),
              drow(['Nachrichten gesendet', String(totalSent), ''],  [5000,2013,2013], 0),
              drow(['Fehler beim Senden',   String(totalFailed), ''], [5000,2013,2013], 1),
              drow(['Kandidaten gesamt',    String(totalCandidates), ''], [5000,2013,2013], 0),
              drow(['Kontakte (letzte 30T)', String(recent), 'aus XING-Historie'], [5000,2013,2013], 1),
            ]
          }),

          new Paragraph({ spacing:{before:300,after:120}, children:[new TextRun({text:'Nach Kampagne', bold:true, size:26, color:dark, font:'Arial'})] }),
          new Table({ width:{size:9026,type:WidthType.DXA}, columnWidths:[3500,1200,1100,1100,1126,1000],
            rows:[
              hrow(['Kampagne','Sequenz','Gesend.','Fehler','Aussteh.','Status'],[3500,1200,1100,1100,1126,1000]),
              ...campData.map((c,i) => drow([
                c.name.slice(0,40), c.seq.slice(0,20),
                String(c.sent), String(c.failed), String(c.pending), c.status
              ], [3500,1200,1100,1100,1126,1000], i))
            ]
          }),

          new Paragraph({ spacing:{before:400,after:0}, border:{top:{style:BorderStyle.SINGLE,size:2,color:purple,space:8}},
            children:[new TextRun({text:'talnt. GmbH · Recruiting Automation · XING Outreach Manager', size:18, color:grey, font:'Arial'})] }),
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `talnt-report-${today.replace(/\./g,'-')}.docx`;
    a.click(); URL.revokeObjectURL(url);
    toast('Report exportiert ✓');

  } catch(e) {
    toast('Fehler: ' + e.message, 'err');
    console.error('[talnt] Report error:', e);
  }
  btn.disabled = false; btn.textContent = '⬇ Report exportieren';
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const history = await S.get('contact_history') || {};
  const now = Date.now();

  // ── Totals ────────────────────────────────────────────────────────────────
  let totalSent = 0, totalFailed = 0, totalCandidates = 0;
  campaigns.forEach(c => {
    totalCandidates += c.candidates?.length || 0;
    c.candidates?.forEach(cand => {
      const steps = cand.steps || {};
      Object.keys(steps).forEach(k => {
        if (!isNaN(k)) {
          if (steps[k] === 'sent') totalSent++;
          if (steps[k] === 'failed') totalFailed++;
        }
      });
      if (cand.status === 'sent') totalSent++;
      if (cand.status === 'failed') totalFailed++;
    });
  });

  const totalHistory = Object.keys(history).length;

  $('dash-totals').innerHTML = [
    { label: 'Nachrichten gesendet', value: totalSent, color: '#4ade80' },
    { label: 'Kandidaten gesamt', value: totalCandidates, color: '#a78bfa' },
    { label: 'Kontakte gespeichert', value: totalHistory, color: '#60a5fa' },
  ].map(s => `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:24px;font-weight:700;color:${s.color}">${s.value}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:4px">${s.label}</div>
    </div>`).join('');

  // ── Per Campaign ──────────────────────────────────────────────────────────
  if (!campaigns.length) {
    $('dash-campaigns').innerHTML = '<div style="color:var(--text3);font-size:12px">Noch keine Kampagnen</div>';
  } else {
    $('dash-campaigns').innerHTML = campaigns.map(c => {
      const total = c.candidates?.length || 0;
      const seq = sequences.find(s => s.id === c.sequenceId);
      const numSteps = seq?.steps?.length || 1;
      const statusColor = { draft:'#475569', running:'#4ade80', paused:'#fb923c', completed:'#a78bfa' };

      // Count per step: how many sent, failed, pending
      const stepColors = ['#a78bfa','#60a5fa','#34d399','#fb923c','#f87171'];
      const stepLabels = ['Erstkontakt','Follow-up 1','Follow-up 2','Follow-up 3','Follow-up 4'];

      // Build step stats for up to 4 follow-ups (steps 0-4)
      const stepStats = [];
      for (let si = 0; si < Math.min(numSteps, 5); si++) {
        let sent = 0, failed = 0, pending = 0;
        (c.candidates || []).forEach(cand => {
          const st = (cand.steps || {})[si];
          if (st === 'sent') sent++;
          else if (st === 'failed') failed++;
          else if (si === 0) {
            // step 0: if candidate has no steps at all, they are pending
            if (!st || st === 'pending') pending++;
          } else {
            // follow-up: pending means prev step sent but delay not passed yet or waiting
            const prevSent = (cand.steps || {})[si - 1];
            if (prevSent === 'sent') pending++;
          }
        });
        stepStats.push({ label: stepLabels[si] || `Schritt ${si+1}`, sent, failed, pending, color: stepColors[si] });
      }

      const totalSent = stepStats.reduce((a, s) => a + s.sent, 0);
      const totalFailed = stepStats.reduce((a, s) => a + s.failed, 0);

      const stepsHtml = stepStats.map(s => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <div style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0"></div>
          <div style="flex:1;font-size:11px;color:var(--text2)">${s.label}</div>
          <div style="font-size:11px;color:#4ade80;min-width:40px;text-align:right">✓ ${s.sent}</div>
          ${s.failed ? `<div style="font-size:11px;color:#f87171;min-width:40px;text-align:right">✗ ${s.failed}</div>` : '<div style="min-width:40px"></div>'}
          <div style="font-size:11px;color:var(--text3);min-width:50px;text-align:right">${s.pending} offen</div>
        </div>`).join('');

      return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:11px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;color:var(--text);font-size:12px">${esc(c.name)}</span>
          <span style="font-size:10px;color:${statusColor[c.status]||'#475569'};font-weight:600">${c.status||'Entwurf'}</span>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-bottom:8px">${seq?esc(seq.name):'Kein Sequenz'} · ${total} Kandidaten · ${totalSent} gesamt gesendet</div>
        ${stepsHtml}
      </div>`;
    }).join('');
  }

  // ── Messages per day chart ────────────────────────────────────────────────
  const days = 14;
  const dayMs = 86400000;
  const counts = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(now - i * dayMs);
    const key = `${d.getDate()}.${d.getMonth()+1}.`;
    counts[key] = 0;
  }

  // Count from contact history
  Object.values(history).forEach(h => {
    if (now - h.lastContacted < days * dayMs) {
      const d = new Date(h.lastContacted);
      const key = `${d.getDate()}.${d.getMonth()+1}.`;
      if (counts[key] !== undefined) counts[key]++;
    }
  });

  const keys = Object.keys(counts).reverse();
  const vals = keys.map(k => counts[k]);
  const maxVal = Math.max(...vals, 1);

  const barWidth = Math.floor(400 / days);
  const chartHeight = 80;

  $('dash-chart').innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:2px;height:${chartHeight}px;margin-bottom:4px">
      ${vals.map((v, i) => {
        const h = Math.max(2, Math.round(v / maxVal * chartHeight));
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <div style="font-size:9px;color:var(--text3)">${v||''}</div>
          <div style="width:100%;height:${h}px;background:linear-gradient(180deg,#8B5CF6,#3B82F6);border-radius:2px 2px 0 0;min-height:2px"></div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:2px">
      ${keys.map((k,i) => `<div style="flex:1;font-size:8px;color:var(--text3);text-align:center;overflow:hidden">${i%2===0?k:''}</div>`).join('')}
    </div>`;
}

// ── Edit Campaign ─────────────────────────────────────────────────────────────
async function showEditCampaign(campId) {
  const camp = campaigns.find(c => c.id === campId);
  if (!camp) return;
  const list = $('list-camp');

  // Build edit form
  const seqOptions = sequences.map(s => `<option value="${s.id}" ${s.id===camp.sequenceId?'selected':''}>${esc(s.name)}</option>`).join('');
  const tplOptions = templates.map(t => `<option value="${t.id}" ${t.id===camp.templateId?'selected':''}>${esc(t.name)}</option>`).join('');

  list.innerHTML = `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
      <b style="color:var(--text);font-size:13px">Kampagne bearbeiten</b>
      <button class="btn btn-ghost btn-sm" id="btn-edit-back">← Zurück</button>
    </div>
    <div class="card">
      <label>Name</label>
      <input id="edit-camp-name" value="${esc(camp.name)}">
      <label>Sequenz</label>
      <select id="edit-camp-seq">
        <option value="">Keine Sequenz</option>
        ${seqOptions}
      </select>
      <label>Oder einzelnes Template</label>
      <select id="edit-camp-tpl">
        <option value="">Kein Template</option>
        ${tplOptions}
      </select>
      <div class="row2">
        <div><label>Position</label><input id="edit-camp-pos" value="${esc(camp.defaultVars?.position||'')}"></div>
        <div><label>Region</label><input id="edit-camp-reg" value="${esc(camp.defaultVars?.region||'')}"></div>
      </div>
      <div class="flex-gap" style="margin-top:4px">
        <button class="btn btn-primary" id="btn-edit-save">Speichern</button>
        <button class="btn btn-ghost" id="btn-edit-back2">Abbrechen</button>
      </div>
    </div>`;

  $('btn-edit-back').addEventListener('click', renderCampaigns);
  $('btn-edit-back2').addEventListener('click', renderCampaigns);
  $('btn-edit-save').addEventListener('click', async () => {
    const name = $('edit-camp-name').value.trim();
    if (!name) { toast('Bitte Namen eingeben', 'err'); return; }
    const idx = campaigns.findIndex(c => c.id === campId);
    if (idx !== -1) {
      campaigns[idx].name = name;
      campaigns[idx].sequenceId = $('edit-camp-seq').value || null;
      campaigns[idx].templateId = $('edit-camp-tpl').value || null;
      campaigns[idx].defaultVars = {
        position: $('edit-camp-pos').value.trim(),
        region: $('edit-camp-reg').value.trim(),
      };
      await S.set('campaigns', campaigns);
      toast('Kampagne gespeichert ✓');
      // Check for update notification
  const updateAvailable = await S.get('update_available');
  if (updateAvailable && $('update-banner')) {
    $('update-banner').classList.remove('hidden');
    if ($('update-version')) $('update-version').textContent = 'v' + updateAvailable;
  }

  renderCampaigns();
    }
  });
}

function renderCampaigns() {
  const list = $('list-camp');
  if (!campaigns.length) {
    list.innerHTML = '<div style="color:#475569;text-align:center;padding:28px 0;font-size:12px">Noch keine Kampagnen</div>';
    return;
  }
  list.innerHTML = campaigns.map(c => {
    const total = c.candidates?.length || 0;
    const sent = c.candidates?.filter(x => x.status === 'sent').length || 0;
    const failed = c.candidates?.filter(x => x.status === 'failed').length || 0;
    const pending = c.candidates?.filter(x => x.status === 'pending').length || 0;
    const tpl = templates.find(t => t.id === c.templateId);
    const statusLabels = { draft:'Entwurf', running:'Läuft', paused:'Pausiert', completed:'Fertig' };
    const canStart = total > 0 && c.status !== 'completed' && c.status !== 'running';
    return `
    <div class="camp-item">
      <div class="flex-between">
        <div class="camp-name">${esc(c.name)}</div>
        <span class="badge badge-${c.status || 'draft'}">${statusLabels[c.status] || 'Entwurf'}</span>
      </div>
      <div class="camp-meta">${esc(tpl?.name || '—')} · ${total} Kandidaten · ${sent} gesendet</div>
      <div class="stats-row">
        <div class="stat"><div class="stat-n" style="color:#64748b">${pending}</div><div class="stat-l">Ausstehend</div></div>
        <div class="stat"><div class="stat-n" style="color:#3b82f6">${sent}</div><div class="stat-l">Gesendet</div></div>
        <div class="stat"><div class="stat-n" style="color:#f87171">${failed}</div><div class="stat-l">Fehler</div></div>
      </div>
      <div class="flex-gap">
        ${c.status === 'running'
          ? `<button class="btn btn-ghost btn-sm" data-pause-camp="${c.id}">⏸ Pausieren</button>`
          : `<button class="btn btn-green btn-sm" data-start-camp="${c.id}" ${!canStart ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>▶ Starten</button>`
        }
        <button class="btn btn-ghost btn-sm" data-view-camp="${c.id}">👥 ${total} Kandidaten</button>
        <button class="btn btn-ghost btn-sm" data-edit-camp="${c.id}">✎ Bearbeiten</button>
        <button class="btn btn-red btn-sm" data-del-camp="${c.id}">Löschen</button>
      </div>
    </div>`;
  }).join('');

  document.querySelectorAll('[data-del-camp]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Kampagne löschen?')) return;
      campaigns = campaigns.filter(c => c.id !== btn.dataset.delCamp);
      await S.set('campaigns', campaigns);
      renderCampaigns();
      toast('Kampagne gelöscht');
    });
  });

  document.querySelectorAll('[data-start-camp]').forEach(btn => {
    btn.addEventListener('click', () => startCampaign(btn.dataset.startCamp));
  });

  document.querySelectorAll('[data-pause-camp]').forEach(btn => {
    btn.addEventListener('click', () => pauseCampaign(btn.dataset.pauseCamp));
  });

  document.querySelectorAll('[data-view-camp]').forEach(btn => {
    btn.addEventListener('click', () => showCandidateList(btn.dataset.viewCamp));
  });

  document.querySelectorAll('[data-edit-camp]').forEach(btn => {
    btn.addEventListener('click', () => showEditCampaign(btn.dataset.editCamp));
  });

  // Sync import select
  const sel = $('sel-import-camp');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Kampagne wählen...</option>' +
      campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (cur) sel.value = cur;
  }
}

function showCampForm(show) {
  $('form-new-camp').classList.toggle('hidden', !show);
  if (show) {
    // Populate sequence select
    const seqSel = $('in-camp-seq');
    if (seqSel) {
      seqSel.innerHTML = '<option value="">Keine Sequenz</option>' +
        sequences.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    }
    // Populate template select
    $('in-camp-tpl').innerHTML = '<option value="">Kein einzelnes Template</option>' +
      templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    $('in-camp-name').focus();
  }
}

async function createCampaign() {
  const name = $('in-camp-name').value.trim();
  const seqSel = $('in-camp-seq');
  const sequenceId = seqSel ? seqSel.value : '';
  const templateId = $('in-camp-tpl').value;
  const position = $('in-camp-pos').value.trim();
  const region = $('in-camp-reg').value.trim();

  if (!name) { toast('Bitte einen Namen eingeben', 'err'); return; }
  if (!sequenceId && !templateId) { toast('Bitte Sequenz oder Template wählen', 'err'); return; }

  const c = {
    id: `camp_${Date.now()}`,
    name, sequenceId: sequenceId||null, templateId: templateId||null,
    defaultVars: { position, region },
    status: 'draft',
    candidates: [],
    createdAt: Date.now(),
  };
  campaigns.push(c);
  await S.set('campaigns', campaigns);
  showCampForm(false);
  $('in-camp-name').value = '';
  $('in-camp-pos').value = '';
  $('in-camp-reg').value = '';
  renderCampaigns();
  addLog(`Kampagne "${name}" erstellt`, 'info');
  toast(`Kampagne "${name}" erstellt ✓`);
}

// ── Templates ──────────────────────────────────────────────────────────────────
function renderTemplates() {
  const list = $('list-tpl');
  if (!templates.length) { list.innerHTML = '<div style="color:#475569;font-size:12px;text-align:center;padding:16px">Keine Templates</div>'; return; }
  const tc = { cold: '#3b82f6', followup: '#f59e0b' };
  const tl = { cold: 'Erstkontakt', followup: 'Follow-up' };
  list.innerHTML = templates.map(t => `
    <div class="card" style="margin-bottom:8px">
      <div class="flex-between">
        <div>
          <span style="background:${tc[t.type]}22;color:${tc[t.type]};border:1px solid ${tc[t.type]}44;border-radius:3px;padding:1px 7px;font-size:10px;font-weight:700;margin-right:6px">${tl[t.type]||t.type}</span>
          <b style="color:#f1f5f9">${esc(t.name)}</b>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" data-edit-tpl="${t.id}">✎</button>
          <button class="btn-del" data-del-tpl="${t.id}">✕</button>
        </div>
      </div>
      <div style="font-size:11px;color:#64748b;margin-top:5px">${esc(t.subject)}</div>
    </div>`).join('');

  document.querySelectorAll('[data-edit-tpl]').forEach(b => b.addEventListener('click', () => showTplForm(b.dataset.editTpl)));
  document.querySelectorAll('[data-del-tpl]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Template löschen?')) return;
    templates = templates.filter(t => t.id !== b.dataset.delTpl);
    await S.set('templates', templates);
    renderTemplates();
    toast('Template gelöscht');
  }));
}

function showTplForm(id = null) {
  editingTplId = id;
  $('tpl-form-title').textContent = id ? 'Template bearbeiten' : 'Neues Template';
  $('list-tpl-wrap').classList.add('hidden');
  $('form-tpl').classList.remove('hidden');
  if (id) {
    const t = templates.find(x => x.id === id);
    if (t) {
      $('in-tpl-name').value = t.name;
      $('in-tpl-type').value = t.type;
      $('in-tpl-subj').value = t.subject;
      $('in-tpl-body').value = t.body;
      updateVarChips();
    }
  } else {
    $('in-tpl-name').value = '';
    $('in-tpl-type').value = 'cold';
    $('in-tpl-subj').value = '';
    $('in-tpl-body').value = '';
    $('tpl-vars').innerHTML = '';
  }
}

function hideTplForm() {
  $('form-tpl').classList.add('hidden');
  $('list-tpl-wrap').classList.remove('hidden');
  renderTemplates();
}

function updateVarChips() {
  const text = $('in-tpl-body').value + ' ' + $('in-tpl-subj').value;
  const vars = [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];
  $('tpl-vars').innerHTML = vars.map(v => `<span class="var-chip">{{${v}}}</span>`).join('');
}

async function saveTemplate() {
  const name = $('in-tpl-name').value.trim();
  const body = $('in-tpl-body').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben', 'err'); return; }
  if (!body) { toast('Bitte einen Text eingeben', 'err'); return; }

  const tpl = {
    id: editingTplId || `tpl_${Date.now()}`,
    name,
    type: $('in-tpl-type').value,
    subject: $('in-tpl-subj').value.trim(),
    body,
  };
  templates = editingTplId
    ? templates.map(t => t.id === editingTplId ? tpl : t)
    : [...templates, tpl];
  await S.set('templates', templates);
  hideTplForm();
  toast('Template gespeichert ✓');
}

// ── Import — uses scripting API to read XING tab directly ─────────────────────
async function extractFromXingTab() {
  const btn = $('btn-extract');
  btn.textContent = '⏳ Lese XING-Seite...';
  btn.disabled = true;

  try {
    // Find the active XING tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let xingTab = tabs[0];

    // If current tab is not XING, find any XING tab
    if (!xingTab?.url?.includes('xing.com')) {
      const xingTabs = await chrome.tabs.query({ url: 'https://*.xing.com/*' });
      if (!xingTabs.length) {
        toast('Bitte XING in Chrome öffnen und Suche durchführen', 'err');
        btn.textContent = '⬇ Kandidaten aus aktivem Tab importieren';
        btn.disabled = false;
        return;
      }
      xingTab = xingTabs[0];
    }

    if (!xingTab.url?.includes('xing.com')) {
      toast('Aktiver Tab ist kein XING. Bitte auf www.xing.com/search navigieren', 'err');
      btn.textContent = '⬇ Kandidaten aus aktivem Tab importieren';
      btn.disabled = false;
      return;
    }

    // Inject extraction script — präzise XING TalentManager Selektoren
    const results = await chrome.scripting.executeScript({
      target: { tabId: xingTab.id },
      func: () => {
        const results = [], seen = new Set();

        // XING TalentManager: jeder Kandidat hat div[id^="candidate_"]
        const cards = document.querySelectorAll('div[id^="candidate_"]');

        cards.forEach(card => {
          const nameLink = card.querySelector('a[data-testid="candidateFullName"]');
          if (!nameLink) return;
          const profileBase = nameLink.href.split('?')[0];
          if (seen.has(profileBase)) return;
          seen.add(profileBase);

          const fullName = (nameLink.textContent || '').trim().replace(/\s+/g, ' ');
          if (!fullName) return;

          const parts = fullName.split(/\s+/);
          const firstName = parts[0] || '';
          const lastName = parts.slice(1).join(' ') || '';

          // Job-Titel: em Element im Titel-Div
          const titleDiv = card.querySelector('.sc-gEkIjz, [class*="dsvFvF"]');
          const em = titleDiv?.querySelector('em');
          const jobTitle = (em ? em.textContent : (titleDiv?.textContent || '')).trim();

          // Firma: erster Span in Firmen-Zeile
          const companySpan = card.querySelector('.sc-fFlnrN, [class*="loTAjD"]');
          const company = (companySpan?.textContent || '').trim();

          // Ort: zweiter Span in .sc-kbdlSk
          let location = '';
          const locDiv = card.querySelector('.sc-kbdlSk, [class*="edtRSh"]');
          if (locDiv) {
            const spans = [...locDiv.querySelectorAll('span')];
            const locSpan = spans.find(s => {
              const t = (s.textContent || '').trim();
              return t.includes(',') && t.length > 3 && t !== company;
            }) || spans[spans.length - 1];
            location = (locSpan?.textContent || '').trim();
          }

          // Ausbildung aus aufgeklapptem Bereich
          let education = '';
          card.querySelectorAll('[class*="gInPiQ"]').forEach(sec => {
            const lbl = sec.querySelector('[class*="jlTEdn"]');
            if ((lbl?.textContent || '').trim() === 'Ausbildung') {
              const e = sec.querySelector('[class*="fHdsHF"], [class*="jBeBSR"]');
              if (e) education = (e.textContent || '').trim();
            }
          });

          results.push({
            name: fullName, firstName, lastName,
            jobTitle, company, location, education,
            profileUrl: nameLink.href,
            profileBaseUrl: profileBase,
            status: 'pending',
          });
        });

        return {
          candidates: results,
          debug: { cards: cards.length, url: window.location.href }
        };
      },
    });

    const raw = results?.[0]?.result || {};
    const candidates = Array.isArray(raw) ? raw : (raw.candidates || []);
    const debug = raw.debug || {};

    addLog('Debug: ' + (debug.cards||0) + ' Kandidaten-Cards gefunden auf ' + (debug.url||'?'), 'info');

    if (!candidates.length) {
      toast('Keine Kandidaten gefunden — scrolle die Ergebnisliste und versuche erneut', 'err');
      addLog('Import fehlgeschlagen: 0 Kandidaten extrahiert', 'err');
      btn.textContent = '⬇ Kandidaten aus aktivem Tab importieren';
      btn.disabled = false;
      return;
    }

    pendingCandidates = candidates;
    showImportResult(candidates);
    addLog(candidates.length + ' Kandidaten aus XING TalentManager importiert', 'ok');
    toast(candidates.length + ' Kandidaten gefunden ✓');

  } catch (err) {
    console.error('[talnt] Extraction error:', err);
    toast('Fehler: ' + err.message, 'err');
    addLog('Extraction error: ' + err.message, 'err');
  }

  btn.textContent = '⬇ Kandidaten aus aktivem Tab importieren';
  btn.disabled = false;
}

function showImportResult(candidates) {
  $('import-count').textContent = `${candidates.length} Kandidaten gefunden`;
  $('import-preview').innerHTML =
    `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1e2d47;margin-bottom:2px">
      <span style="font-size:10px;color:#475569">Name</span>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:10px;color:#475569;font-weight:400;margin:0">
        <input type="checkbox" id="chk-all-import" checked style="width:auto;margin:0;padding:0"> Alle
      </label>
    </div>` +
    candidates.map((c,i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #1e2d47;font-size:11px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:1;text-transform:none;letter-spacing:0;font-weight:400;margin:0">
        <input type="checkbox" class="chk-import-cand" data-idx="${i}" checked style="width:auto;margin:0;padding:0;flex-shrink:0">
        <span style="color:#e2e8f0">${esc(c.name)}</span>
      </label>
      <span style="color:#475569;font-size:10px;margin-left:6px">${esc((c.jobTitle||'').slice(0,25))}</span>
    </div>`).join('');

  // Select all toggle
  setTimeout(() => {
    const chkAll = $('chk-all-import');
    if(chkAll) chkAll.addEventListener('change', e => {
      document.querySelectorAll('.chk-import-cand').forEach(cb => cb.checked = e.target.checked);
    });
  }, 50);

  $('sel-import-camp').innerHTML = '<option value="">Kampagne wählen...</option>' +
    campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  if($('import-zone')) ($('import-zone') && $('import-zone').classList).add('active');
  $('import-result').classList.remove('hidden');
}

async function assignImport() {
  const campId = $('sel-import-camp').value;
  if (!campId) { toast('Bitte Kampagne wählen', 'err'); return; }
  if (!pendingCandidates.length) { toast('Keine Kandidaten vorhanden', 'err'); return; }

  const idx = campaigns.findIndex(c => c.id === campId);
  if (idx === -1) return;

  // Only use checked candidates
  const checkedBoxes = [...document.querySelectorAll('.chk-import-cand:checked')];
  const selectedIdxs = new Set(checkedBoxes.map(b => parseInt(b.dataset.idx)));
  const selected = pendingCandidates.filter((_,i) => selectedIdxs.size === 0 || selectedIdxs.has(i));
  if(!selected.length){ toast('Keine Kandidaten ausgewählt','err'); return; }

  const baseUrl = url => (url||'').split('?')[0].split('#')[0].replace(/\/$/, '');
  const existing = new Set(campaigns[idx].candidates.map(c => baseUrl(c.profileBaseUrl || c.profileUrl)));
  const seenUrls = new Set();
  const newOnes = selected
    .filter(c => {
      const u = baseUrl(c.profileBaseUrl || c.profileUrl);
      if (!u || existing.has(u) || seenUrls.has(u)) return false;
      seenUrls.add(u);
      return true;
    })
    .map(c => ({ ...c, id: `cand_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` }));

  campaigns[idx].candidates.push(...newOnes);
  await S.set('campaigns', campaigns);

  pendingCandidates = [];
  $('import-result').classList.add('hidden');
  if($('import-zone')) ($('import-zone') && $('import-zone').classList).remove('active');
  renderCampaigns();
  addLog(`${newOnes.length} Kandidaten zu "${campaigns[idx].name}" zugewiesen`, 'ok');
  toast(`${newOnes.length} Kandidaten zugewiesen ✓`);
}


// ── Start Campaign — delegates to background service worker ──────────────────
async function startCampaign(campId) {
  const camp = campaigns.find(c => c.id === campId);
  if (!camp) return;

  const pending = camp.candidates?.filter(c => c.status === 'pending') || [];
  if (!pending.length) { toast('Keine ausstehenden Kandidaten in dieser Kampagne', 'err'); return; }

  try {
    await chrome.runtime.sendMessage({ type: 'START_CAMPAIGN', campId });
    camp.status = 'running';
    await S.set('campaigns', campaigns);
    renderCampaigns();
    addLog(`Kampagne "${camp.name}" gestartet — ${pending.length} Kandidaten`, 'info');
    toast(`▶ Gestartet — ${pending.length} Nachrichten werden gesendet`);
  } catch (e) {
    toast('Fehler beim Starten: ' + e.message, 'err');
  }
}

async function pauseCampaign(campId) {
  const camp = campaigns.find(c => c.id === campId);
  if (!camp) return;
  try {
    await chrome.runtime.sendMessage({ type: 'PAUSE_CAMPAIGN', campId });
    camp.status = 'paused';
    await S.set('campaigns', campaigns);
    renderCampaigns();
    toast('⏸ Kampagne pausiert');
  } catch (e) {
    toast('Fehler: ' + e.message, 'err');
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Show candidate list for a campaign ────────────────────────────────────────
async function showCandidateList(campId) {
  const camp = campaigns.find(c => c.id === campId);
  if (!camp) return;
  const history = await S.get('contact_history') || {};
  const now = Date.now();
  const d30 = 30*24*60*60*1000, d60 = 60*24*60*60*1000;

  let listFilter = 'all'; // all | contacted | never

  const statusColor = { pending:'#94a3b8', sent:'#4ade80', failed:'#f87171', sending:'#fb923c' };
  const statusLabel = { pending:'Ausstehend', sent:'Gesendet', failed:'Fehler', sending:'Läuft...' };

  function getHistoryBadge(c) {
    const burl = (c.profileBaseUrl||c.profileUrl||'').split('?')[0];
    const h = history[burl] || history[`name:${c.name}`];
    if (!h) return { badge: '<span style="background:#052e16;color:#4ade80;border-radius:3px;padding:1px 6px;font-size:10px">Nie kontaktiert</span>', contacted: false };
    const days = Math.floor((now - h.lastContacted) / 86400000);
    const age = now - h.lastContacted;
    const color = age < d30 ? '#fb923c' : age < d60 ? '#94a3b8' : '#64748b';
    const label = days === 0 ? 'Heute' : days === 1 ? 'Gestern' : `vor ${days}T`;
    return {
      badge: `<span style="background:#1e2d47;color:${color};border-radius:3px;padding:1px 6px;font-size:10px">${label} · ${esc(h.by||'?')}</span>`,
      contacted: true, days,
    };
  }

  function renderList() {
    const filtered = camp.candidates.filter(c => {
      const burl = (c.profileBaseUrl||c.profileUrl||'').split('?')[0];
      const h = history[burl] || history[`name:${c.name}`];
      const age = h ? now - h.lastContacted : null;
      const { contacted } = getHistoryBadge(c);
      if (listFilter === 'never') return !contacted;
      if (listFilter === 'contacted') return contacted;
      if (listFilter === '30') return h && age < d30;
      if (listFilter === '60') return h && age >= d30 && age < d60;
      if (listFilter === '90') return h && age >= d60;
      return true;
    });

    const neverCount = camp.candidates.filter(c => !getHistoryBadge(c).contacted).length;
    const contactedCount = camp.candidates.filter(c => getHistoryBadge(c).contacted).length;

    $('list-camp').innerHTML = `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b style="color:#f1f5f9;font-size:13px">${esc(camp.name)}</b>
          <button class="btn btn-ghost btn-sm" id="btn-back-camp">← Zurück</button>
        </div>
        <div style="display:flex;gap:5px;margin-bottom:6px;flex-wrap:wrap">
          <button class="filter-btn ${listFilter==='all'?'active':''}" id="lf-all">Alle (${camp.candidates.length})</button>
          <button class="filter-btn ${listFilter==='never'?'active':''}" id="lf-never" style="${listFilter!=='never'?'color:#4ade80':''}">✓ Nie (${neverCount})</button>
          <button class="filter-btn ${listFilter==='contacted'?'active':''}" id="lf-contacted" style="${listFilter!=='contacted'?'color:#fb923c':''}">⚠ Schon (${contactedCount})</button>
        </div>
        <div style="display:flex;gap:5px;margin-bottom:8px;flex-wrap:wrap">
          <button class="filter-btn ${listFilter==='30'?'active':''}" id="lf-30" style="font-size:10px">&lt; 30T (${camp.candidates.filter(c=>{const h=history[(c.profileBaseUrl||c.profileUrl||'').split('?')[0]]||history['name:'+c.name];return h&&(now-h.lastContacted)<d30;}).length})</button>
          <button class="filter-btn ${listFilter==='60'?'active':''}" id="lf-60" style="font-size:10px">30–60T (${camp.candidates.filter(c=>{const h=history[(c.profileBaseUrl||c.profileUrl||'').split('?')[0]]||history['name:'+c.name];const a=h?now-h.lastContacted:null;return h&&a>=d30&&a<d60;}).length})</button>
          <button class="filter-btn ${listFilter==='90'?'active':''}" id="lf-90" style="font-size:10px">&gt; 60T (${camp.candidates.filter(c=>{const h=history[(c.profileBaseUrl||c.profileUrl||'').split('?')[0]]||history['name:'+c.name];return h&&(now-h.lastContacted)>=d60;}).length})</button>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
          <button id="btn-remove-contacted" class="btn btn-red btn-sm" style="flex:1;justify-content:center">
            ✕ Alle Schon (${contactedCount})
          </button>
          <button id="btn-remove-30" class="btn btn-red btn-sm" style="flex:1;justify-content:center">
            ✕ &lt; 30T
          </button>
          <button id="btn-remove-60" class="btn btn-red btn-sm" style="flex:1;justify-content:center">
            ✕ 30–60T
          </button>
          <button id="btn-remove-90" class="btn btn-red btn-sm" style="flex:1;justify-content:center">
            ✕ &gt; 60T
          </button>
        </div>
      </div>
      <div style="max-height:320px;overflow-y:auto">
        ${filtered.map(c => {
          const {badge} = getHistoryBadge(c);
          const canRemove = c.status !== 'sent' && c.status !== 'sending';
          return `<div style="padding:7px 0;border-bottom:1px solid #1e2d47;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="color:#e2e8f0;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>
              <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap">
                ${badge}
                <span style="background:#1e2d47;color:${statusColor[c.status]||'#94a3b8'};border-radius:3px;padding:1px 6px;font-size:10px">${statusLabel[c.status]||c.status}</span>
              </div>
            </div>
            ${canRemove ? `<button id="rm-${c.id}" class="btn-del" style="color:#f87171;flex-shrink:0" title="Entfernen">✕</button>` : ''}
          </div>`;
        }).join('')}
        ${filtered.length===0?'<div style="color:#475569;text-align:center;padding:20px;font-size:12px">Keine Kandidaten in diesem Filter</div>':''}
      </div>`;

    // Bind back
    $('btn-back-camp').addEventListener('click', renderCampaigns);

    // Filter buttons
    ['all','never','contacted','30','60','90'].forEach(f => {
      const btn = $(`lf-${f}`);
      if(btn) btn.addEventListener('click', () => { listFilter = f; renderList(); });
    });

    async function removeCandidates(filterFn, label) {
      const toRemove = camp.candidates.filter(c => filterFn(c) && c.status!=='sent' && c.status!=='sending');
      if(!toRemove.length){toast(`Keine ${label} zum Entfernen`,'err');return;}
      if(!confirm(`${toRemove.length} Kandidaten (${label}) entfernen?`)) return;
      const ci = campaigns.findIndex(x => x.id === campId);
      if(ci !== -1) {
        const removeIds = new Set(toRemove.map(c => c.id));
        campaigns[ci].candidates = campaigns[ci].candidates.filter(c => !removeIds.has(c.id));
        await S.set('campaigns', campaigns);
        toast(`${toRemove.length} Kandidaten entfernt ✓`);
        showCandidateList(campId);
      }
    }

    $('btn-remove-contacted').addEventListener('click', () =>
      removeCandidates(c => getHistoryBadge(c).contacted, 'bereits Angeschriebene'));
    $('btn-remove-30').addEventListener('click', () =>
      removeCandidates(c => { const h=history[(c.profileBaseUrl||c.profileUrl||'').split('?')[0]]||history[`name:${c.name}`]; return h&&(now-h.lastContacted)<d30; }, '< 30 Tage'));
    $('btn-remove-60').addEventListener('click', () =>
      removeCandidates(c => { const h=history[(c.profileBaseUrl||c.profileUrl||'').split('?')[0]]||history[`name:${c.name}`]; const a=h?now-h.lastContacted:null; return h&&a>=d30&&a<d60; }, '30–60 Tage'));
    $('btn-remove-90').addEventListener('click', () =>
      removeCandidates(c => { const h=history[(c.profileBaseUrl||c.profileUrl||'').split('?')[0]]||history[`name:${c.name}`]; return h&&(now-h.lastContacted)>=d60; }, '> 60 Tage'));

    // Individual remove
    camp.candidates.forEach(c => {
      const btn = $(`rm-${c.id}`);
      if(btn) btn.addEventListener('click', async () => {
        const ci = campaigns.findIndex(x => x.id === campId);
        if(ci !== -1) {
          campaigns[ci].candidates = campaigns[ci].candidates.filter(x => x.id !== c.id);
          await S.set('campaigns', campaigns);
          showCandidateList(campId);
          toast(`${c.name} entfernt`);
        }
      });
    });
  }

  renderList();
}


// ── Sequences ─────────────────────────────────────────────────────────────────
let editingSeqId = null;
let seqSteps = [];

const DEFAULT_SEQUENCES = [
  { id:'seq_default', name:'Erstkontakt + 3 Follow-ups',
    steps:[
      {label:'Erstkontakt', templateId:'', delayDays:0},
      {label:'Follow-up 1', templateId:'', delayDays:3},
      {label:'Follow-up 2', templateId:'', delayDays:5},
      {label:'Follow-up 3', templateId:'', delayDays:7},
    ]}
];

function renderSequences() {
  const list=$('list-seq');
  if(!list) return;
  if(!sequences.length){
    list.innerHTML='<div style="color:#475569;font-size:12px;text-align:center;padding:16px">Noch keine Sequenzen — erstelle eine!</div>';
    return;
  }
  list.innerHTML=sequences.map(s=>`
    <div class="card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b style="color:#f1f5f9">${esc(s.name)}</b>
        <div style="display:flex;gap:4px">
          <button id="edit-seq-${s.id}" class="btn btn-ghost btn-sm">✎</button>
          <button id="del-seq-${s.id}" class="btn-del">✕</button>
        </div>
      </div>
      ${(s.steps||[]).map((step,i)=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:11px">
          <div style="width:18px;height:18px;background:#1e3a5f;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#60a5fa;font-weight:700;font-size:10px;flex-shrink:0">${i+1}</div>
          <span style="flex:1;color:#94a3b8">${esc(step.label)}</span>
          <span style="color:${i===0?'#4ade80':'#f59e0b'};font-size:10px">${i===0?'Sofort':'+'+step.delayDays+' Tage'}</span>
          <span style="color:#475569;font-size:10px">${esc(templates.find(t=>t.id===step.templateId)?.name||'⚠ kein Template')}</span>
        </div>`).join('')}
    </div>`).join('');

  sequences.forEach(s=>{
    const e=$(`edit-seq-${s.id}`); if(e) e.addEventListener('click',()=>showSeqForm(s.id));
    const d=$(`del-seq-${s.id}`); if(d) d.addEventListener('click',async()=>{
      if(!confirm('Sequenz löschen?')) return;
      sequences=sequences.filter(x=>x.id!==s.id);
      await S.set('sequences',sequences); renderSequences(); toast('Gelöscht');
    });
  });
}

function showSeqForm(id=null) {
  editingSeqId=id;
  $('seq-form-title').textContent=id?'Sequenz bearbeiten':'Neue Sequenz';
  $('list-seq-wrap').classList.add('hidden');
  $('form-seq').classList.remove('hidden');
  if(id){
    const s=sequences.find(x=>x.id===id);
    if(s){ $('in-seq-name').value=s.name; seqSteps=s.steps.map(x=>({...x})); }
  } else {
    $('in-seq-name').value='';
    seqSteps=[
      {label:'Erstkontakt',templateId:'',delayDays:0},
      {label:'Follow-up 1',templateId:'',delayDays:3},
      {label:'Follow-up 2',templateId:'',delayDays:5},
      {label:'Follow-up 3',templateId:'',delayDays:7},
    ];
  }
  renderSeqBuilder();
}

function renderSeqBuilder() {
  const c=$('seq-steps-builder');
  c.innerHTML=seqSteps.map((step,i)=>`
    <div class="seq-step">
      ${i>0?`<div class="seq-delay">
        <span>↓ nach</span>
        <input type="number" id="sd-delay-${i}" min="1" max="60" value="${step.delayDays}">
        <span>Tagen</span>
      </div>`:'<div style="font-size:10px;color:#4ade80;margin-bottom:6px">▶ Wird sofort gesendet</div>'}
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <div style="width:20px;height:20px;background:#1e3a5f;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#60a5fa;font-weight:700;font-size:10px;flex-shrink:0">${i+1}</div>
        <input id="sd-label-${i}" value="${esc(step.label)}" placeholder="Name" style="flex:1;margin:0;padding:5px 8px">
        ${i>0?`<button id="sd-del-${i}" class="btn-del" style="color:#f87171">✕</button>`:''}
      </div>
      <label>Template</label>
      <select id="sd-tpl-${i}" style="margin-bottom:0">
        <option value="">Template wählen...</option>
        ${templates.map(t=>`<option value="${t.id}" ${t.id===step.templateId?'selected':''}>${esc(t.name)}</option>`).join('')}
      </select>
    </div>`).join('');

  seqSteps.forEach((_,i)=>{
    const d=$(`sd-delay-${i}`); if(d) d.addEventListener('input',e=>{seqSteps[i].delayDays=parseInt(e.target.value)||1;});
    const l=$(`sd-label-${i}`); if(l) l.addEventListener('input',e=>{seqSteps[i].label=e.target.value;});
    const t=$(`sd-tpl-${i}`);   if(t) t.addEventListener('change',e=>{seqSteps[i].templateId=e.target.value;});
    const x=$(`sd-del-${i}`);   if(x) x.addEventListener('click',()=>{seqSteps.splice(i,1);renderSeqBuilder();});
  });
}

function hideSeqForm() {
  $('form-seq').classList.add('hidden');
  $('list-seq-wrap').classList.remove('hidden');
  renderSequences();
}

async function saveSequence() {
  const name=$('in-seq-name').value.trim();
  if(!name){toast('Bitte Namen eingeben','err');return;}
  if(!seqSteps.length){toast('Mindestens ein Schritt nötig','err');return;}
  if(seqSteps.some(s=>!s.templateId)){toast('Alle Schritte brauchen ein Template','err');return;}
  const seq={id:editingSeqId||`seq_${Date.now()}`,name,steps:seqSteps.map(s=>({...s}))};
  sequences=editingSeqId?sequences.map(s=>s.id===editingSeqId?seq:s):[...sequences,seq];
  await S.set('sequences',sequences);
  hideSeqForm();
  toast('Sequenz gespeichert ✓');
}



// ── Contact History Tab ───────────────────────────────────────────────────────
let historyFilter = 'all', historySearch = '';

async function renderHistory() {
  const history = await S.get('contact_history') || {};
  const now = Date.now();
  const d30 = 30*24*60*60*1000, d60 = 60*24*60*60*1000;

  let entries = Object.entries(history).map(([key, h]) => ({ key, ...h }));

  // Sort by most recent first
  entries.sort((a, b) => b.lastContacted - a.lastContacted);

  // Apply filter
  entries = entries.filter(h => {
    const age = now - h.lastContacted;
    if(historyFilter === '30') return age < d30;
    if(historyFilter === '60') return age >= d30 && age < d60;
    if(historyFilter === '90') return age >= d60;
    return true;
  });

  // Apply search
  if(historySearch) {
    entries = entries.filter(h => (h.name||'').toLowerCase().includes(historySearch.toLowerCase()));
  }

  const el = $('history-list');
  if(!el) return;

  if(!entries.length) {
    el.innerHTML = `<div style="color:#475569;text-align:center;padding:30px 0;font-size:12px">
      ${Object.keys(history).length === 0
        ? 'Noch keine Kontakte gespeichert.<br><br>Gehe zu Einstellungen → "XING Nachrichtenhistorie importieren"'
        : 'Keine Einträge für diesen Filter'}
    </div>`;
    return;
  }

  el.innerHTML = entries.map(h => {
    const daysSince = Math.floor((now - h.lastContacted) / 86400000);
    const dateStr = daysSince === 0 ? 'Heute' : daysSince === 1 ? 'Gestern' : `vor ${daysSince} Tagen`;
    const color = daysSince < 30 ? '#fb923c' : daysSince < 60 ? '#94a3b8' : '#475569';
    const profileUrl = h.key.startsWith('name:') ? '' : h.key;

    return `<div style="padding:8px 0;border-bottom:1px solid #1e2d47;display:flex;align-items:center;gap:10px">
      <div style="flex:1">
        <div style="color:#e2e8f0;font-weight:500;font-size:12px">${esc(h.name||'Unbekannt')}</div>
        <div style="font-size:10px;margin-top:2px">
          <span style="color:${color}">${dateStr}</span>
          <span style="color:#334155"> · </span>
          <span style="color:#64748b">${esc(h.by||'?')}</span>
          ${h.count > 1 ? `<span style="color:#334155"> · </span><span style="color:#475569">${h.count}x kontaktiert</span>` : ''}
        </div>
      </div>
      ${profileUrl ? `<a href="${profileUrl}" target="_blank" style="color:#60a5fa;font-size:10px;text-decoration:none;flex-shrink:0">Profil →</a>` : ''}
    </div>`;
  }).join('');

  // Update filter counts
  const total = Object.keys(history).length;
  const c30 = Object.values(history).filter(h => (now-h.lastContacted) < d30).length;
  const c60 = Object.values(history).filter(h => { const a=now-h.lastContacted; return a>=d30&&a<d60; }).length;
  const c90 = Object.values(history).filter(h => (now-h.lastContacted) >= d60).length;
  if($('hfilter-all')) $('hfilter-all').textContent = `Alle (${total})`;
  if($('hfilter-30')) $('hfilter-30').textContent = `< 30T (${c30})`;
  if($('hfilter-60')) $('hfilter-60').textContent = `30–60T (${c60})`;
  if($('hfilter-90')) $('hfilter-90').textContent = `> 60T (${c90})`;
}

let _historyBound = false;
function bindHistoryTab() {
  if(_historyBound) return;
  _historyBound = true;

  ['all','30','60','90'].forEach(f => {
    const btn = $(`hfilter-${f}`);
    if(btn) btn.addEventListener('click', () => {
      historyFilter = f;
      document.querySelectorAll('[id^="hfilter-"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderHistory();
    });
  });

  const search = $('in-history-search');
  if(search) search.addEventListener('input', e => { historySearch = e.target.value; renderHistory(); });

  const clearBtn = $('btn-clear-history');
  if(clearBtn) clearBtn.addEventListener('click', async () => {
    if(!confirm('Gesamte Kontakthistorie löschen?')) return;
    await S.set('contact_history', {});
    renderHistory();
    toast('Historie gelöscht');
  });
}


// ── Import from XING Project ──────────────────────────────────────────────────
async function extractFromXingProject() {
  const btn = $('btn-extract-project');
  const status = $('project-status');
  const input = $('in-project-url').value.trim();
  if (!input) { toast('Bitte Projekt-URL oder ID eingeben', 'err'); return; }

  // Extract project ID from URL or use directly
  const idMatch = input.match(/projects\/(\d+)/) || input.match(/^(\d+)$/);
  if (!idMatch) { toast('Ungültige Projekt-URL oder ID', 'err'); return; }
  const projectId = idMatch[1];

  btn.disabled = true; btn.textContent = '⏳ Lade Projekt...';
  status.innerHTML = '<span style="color:#a78bfa">Öffne Projekt...</span>';

  try {
    let allCandidates = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `https://www.xing.com/xtm/projects/${projectId}?page=${page}`;
      status.innerHTML = `<span style="color:#a78bfa">Lese Seite ${page}...</span>`;

      // Open project page in background window (same as message sending)
      const bgResponse = await chrome.runtime.sendMessage({ type: 'GET_BG_WINDOW' });
      const windowId = bgResponse?.windowId;
      const tab = windowId
        ? await chrome.tabs.create({ url, windowId, active: false })
        : await chrome.tabs.create({ url, active: false });

      // Wait for page load
      await new Promise(resolve => {
        const fn = (id, info) => {
          if (id === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(fn);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(fn);
        setTimeout(resolve, 12000);
      });
      await new Promise(r => setTimeout(r, 2500));

      // Extract candidates
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const results = [], seen = new Set();
          document.querySelectorAll('div[id^="candidate_"]').forEach(card => {
            const nameLink = card.querySelector('a[data-testid="candidateFullName"]');
            if (!nameLink) return;
            const profileBase = nameLink.href.split('?')[0];
            if (seen.has(profileBase)) return; seen.add(profileBase);
            const fullName = (nameLink.textContent || '').trim().replace(/\s+/g, ' ');
            if (!fullName) return;
            const parts = fullName.split(/\s+/);
            const titleDiv = card.querySelector('.sc-gEkIjz,[class*="dsvFvF"]');
            const em = titleDiv?.querySelector('em');
            const jobTitle = (em ? em.textContent : (titleDiv?.textContent || '')).trim();
            const companySpan = card.querySelector('.sc-fFlnrN,[class*="loTAjD"]');
            const company = (companySpan?.textContent || '').trim();
            let location = '';
            const locDiv = card.querySelector('.sc-kbdlSk,[class*="edtRSh"]');
            if (locDiv) {
              const spans = [...locDiv.querySelectorAll('span')];
              const locSpan = spans.find(s => { const t = (s.textContent||'').trim(); return t.includes(',') && t.length > 3 && t !== company; });
              location = (locSpan || spans[spans.length-1])?.textContent?.trim() || '';
            }
            // Check if next page exists
            const pagination = document.querySelector('[data-wry="Pagination"]');
            const currentPage = pagination?.querySelector('[data-testid="current-page-item"]');
            const nextPage = currentPage?.nextElementSibling;
            const hasNext = nextPage && !nextPage.hasAttribute('disabled') && nextPage.textContent.trim() !== '...';
            results.push({ name:fullName, firstName:parts[0]||'', lastName:parts.slice(1).join(' ')||'', jobTitle, company, location, education:'', profileUrl:nameLink.href, profileBaseUrl:profileBase, status:'pending', _hasNext: hasNext });
          });
          // Also check pagination
          const pagination = document.querySelector('[data-wry="Pagination"]');
          const currentPage = pagination?.querySelector('[data-testid="current-page-item"]');
          const nextSibling = currentPage?.nextElementSibling;
          const hasNextPage = nextSibling && !nextSibling.hasAttribute('disabled') && nextSibling.textContent.trim() !== '...' && !nextSibling.querySelector('svg');
          return { candidates: results, hasNextPage };
        }
      });

      await chrome.tabs.remove(tab.id);

      const pageData = results?.[0]?.result;
      if (pageData?.candidates?.length) {
        allCandidates = allCandidates.concat(pageData.candidates);
        hasMore = pageData.hasNextPage && page < 20; // max 20 pages
        page++;
        await new Promise(r => setTimeout(r, 1500));
      } else {
        hasMore = false;
      }
    }

    if (!allCandidates.length) {
      status.innerHTML = '<span style="color:#f87171">Keine Kandidaten gefunden</span>';
      toast('Keine Kandidaten im Projekt gefunden', 'err');
      return;
    }

    pendingCandidates = allCandidates;
    showImportResult(allCandidates);
    status.innerHTML = `<span style="color:#4ade80">✓ ${allCandidates.length} Kandidaten geladen</span>`;
    addLog(`Projekt ${projectId}: ${allCandidates.length} Kandidaten importiert`, 'ok');
    toast(`${allCandidates.length} Kandidaten aus Projekt geladen ✓`);

  } catch(e) {
    status.innerHTML = `<span style="color:#f87171">Fehler: ${esc(e.message)}</span>`;
    toast('Fehler: ' + e.message, 'err');
    addLog('Projekt Import Fehler: ' + e.message, 'err');
  }

  btn.disabled = false; btn.textContent = '⬇ Projekt importieren';
}

// ── Import contact history from XING messages page ───────────────────────────
async function importXingHistory() {
  const btn = $('btn-import-xing-history');
  const result = $('xing-history-result');
  btn.disabled = true; btn.textContent = '⏳ Lese XING Nachrichten...';
  result.innerHTML = '';

  try {
    // Find XING messages tab
    const tabs = await chrome.tabs.query({ url: 'https://www.xing.com/*' });
    const msgTabs = tabs.filter(t =>
      t.url.includes('/xtm/inbox') || t.url.includes('/xtm/conversations') ||
      t.url.includes('/messages') || t.url.includes('xing.com')
    );

    if (!msgTabs.length) {
      result.innerHTML = '<span style="color:#f87171">Bitte XING in Chrome öffnen</span>';
      return;
    }

    // Try each tab to find the one with conversation list
    let extracted = null;
    for (const tab of msgTabs) {
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const conversations = [];

            // Find all chat list items
            const items = document.querySelectorAll('article[data-testid="chat-list-item"]');

            items.forEach(item => {
              // Candidate name — first text element
              const nameEl = item.querySelector('[data-wry="Text"]');
              const name = nameEl?.textContent?.trim() || '';
              if (!name) return;

              // Date
              const timeEl = item.querySelector('time[data-testid="chat-datetime"]');
              const dateText = timeEl?.textContent?.trim() || '';
              const dateAttr = timeEl?.getAttribute('datetime') || '';

              // Sender avatar (who sent the message)
              const avatarImg = item.querySelector('img[alt]');
              const senderName = avatarImg?.getAttribute('alt') || '';

              // Participants text (e.g. "Falko Tröger und Sie")
              const participantsEl = item.querySelectorAll('[data-wry="Text"]');
              const participants = [...participantsEl].map(el => el.textContent?.trim()).filter(Boolean);

              // Profile link if available
              const profileLink = item.querySelector('a[href*="/profile/"], a[href*="/talent/profile/"]');
              const profileUrl = profileLink?.href || '';

              // Parse date
              let timestamp = null;
              if (dateAttr) {
                timestamp = new Date(dateAttr).getTime();
              } else if (dateText) {
                // Parse German date: "29. Jan. 2025" or "Gestern" or "14:30"
                const monthMap = {
                  'jan':0,'feb':1,'mär':2,'mar':2,'apr':3,'mai':4,'may':4,
                  'jun':5,'jul':6,'aug':7,'sep':8,'okt':9,'oct':9,'nov':10,'dez':11,'dec':11,
                  'januar':0,'februar':1,'märz':2,'april':3,'juni':5,'juli':6,
                  'august':7,'september':8,'oktober':9,'november':10,'dezember':11
                };
                const match = dateText.match(/(\d+)\.\s*([\wä]+)\.?\s*(\d{4})?/i);
                if (match) {
                  const day = parseInt(match[1]);
                  const monthKey = match[2].toLowerCase();
                  const month = monthMap[monthKey] ?? monthMap[monthKey.slice(0,3)] ?? 0;
                  const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
                  timestamp = new Date(year, month, day).getTime();
                } else if (dateText.toLowerCase() === 'gestern') {
                  timestamp = Date.now() - 86400000;
                } else if (dateText.match(/^\d{1,2}:\d{2}$/)) {
                  timestamp = Date.now(); // today
                }
              }

              if (name && timestamp) {
                conversations.push({ name, senderName, dateText, timestamp, profileUrl, participants });
              }
            });

            return {
              conversations,
              url: window.location.href,
              total: items.length,
            };
          }
        });

        if (res?.[0]?.result?.conversations?.length) {
          extracted = res[0].result;
          break;
        }
      } catch (e) {
        console.log('[talnt] Tab error:', e.message);
      }
    }

    if (!extracted || !extracted.conversations.length) {
      // Try navigating to XING messages
      result.innerHTML = '<span style="color:#f87171">Keine Konversationen gefunden. Bitte öffne <b>www.xing.com/xtm/inbox</b> und scrolle die Liste durch.</span>';
      return;
    }

    // Merge into contact_history storage
    const history = await S.get('contact_history') || {};
    let imported = 0, updated = 0;

    for (const conv of extracted.conversations) {
      // Use name as key since we may not have profile URL
      const key = conv.profileUrl ? conv.profileUrl.split('?')[0] : `name:${conv.name}`;

      const existing = history[key];
      if (!existing || conv.timestamp > existing.lastContacted) {
        history[key] = {
          lastContacted: conv.timestamp,
          by: conv.senderName || myName || 'XING',
          count: (existing?.count || 0) + 1,
          name: conv.name,
          dateText: conv.dateText,
          source: 'xing_import',
        };
        if (existing) updated++; else imported++;
      }
    }

    await S.set('contact_history', history);

    result.innerHTML = `<span style="color:#4ade80">✓ ${imported} neu importiert, ${updated} aktualisiert (${extracted.conversations.length} Konversationen gelesen)</span>`;
    addLog(`XING Historie importiert: ${imported + updated} Konversationen`, 'ok');
    toast(`${imported + updated} Kontakte aus XING importiert ✓`);

  } catch (e) {
    result.innerHTML = `<span style="color:#f87171">Fehler: ${esc(e.message)}</span>`;
    addLog('XING History Import Fehler: ' + e.message, 'err');
  }

  btn.disabled = false; btn.textContent = '⬇ XING Nachrichtenhistorie importieren';
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function initApp() {
  // Load data
  templates = await S.get('templates') || [];
  if (!templates.length) { templates = DEFAULT_TEMPLATES; await S.set('templates', templates); }
  sequences = await S.get('sequences') || [];
  campaigns = await S.get('campaigns') || [];
  logs = await S.get('logs') || [];

  // Tabs
  initTabs();

  // Campaign
  $('btn-new-camp').addEventListener('click', () => showCampForm(true));
  $('btn-save-camp').addEventListener('click', createCampaign);
  $('btn-cancel-camp').addEventListener('click', () => showCampForm(false));
  $('in-camp-name').addEventListener('keydown', e => { if (e.key === 'Enter') createCampaign(); });

  // Templates
  $('btn-new-tpl').addEventListener('click', () => showTplForm(null));
  $('btn-save-tpl').addEventListener('click', saveTemplate);
  $('btn-cancel-tpl').addEventListener('click', hideTplForm);
  $('in-tpl-body').addEventListener('input', updateVarChips);
  $('in-tpl-subj').addEventListener('input', updateVarChips);

  // Import
  $('btn-extract').addEventListener('click', extractFromXingTab);
  if($('btn-extract-project')) $('btn-extract-project').addEventListener('click', extractFromXingProject);
  $('btn-assign').addEventListener('click', assignImport);
  $('btn-clear-import').addEventListener('click', () => {
    pendingCandidates = [];
    $('import-result').classList.add('hidden');
    if($('import-zone')) ($('import-zone') && $('import-zone').classList).remove('active');
  });

  // Log
  $('btn-clear-log').addEventListener('click', async () => {
    logs = [];
    await S.set('logs', []);
    renderLog();
  });

  // Render
  renderCampaigns();
  renderTemplates();
  renderLog();

  // Auto-refresh from storage every 3s (picks up background worker updates)
  setInterval(async () => {
    const fresh = await S.get('campaigns') || [];
    const freshLogs = await S.get('logs') || [];
    const changed = JSON.stringify(fresh) !== JSON.stringify(campaigns);
    const logsChanged = freshLogs.length !== logs.length;
    if (changed) { campaigns = fresh; renderCampaigns(); }
    if (logsChanged) { logs = freshLogs; renderLog(); }
  }, 3000);
}

document.addEventListener('DOMContentLoaded', checkAuth);

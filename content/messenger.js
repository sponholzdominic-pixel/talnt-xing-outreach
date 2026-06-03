// ─── talnt. Content Script — Messenger ───────────────────────────────────────
(function() {
  if (window.__talntMessenger) return;
  window.__talntMessenger = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log('[talnt.]', ...a);

  const waitFor = (fn, maxMs = 15000) => new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      const el = fn(); if (el) return resolve(el);
      if (Date.now() - start > maxMs) return resolve(null);
      setTimeout(tick, 500);
    };
    tick();
  });

  function setNativeValue(el, val) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, val); else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fillAndSend(msg, subj) {
    log('Start auf:', window.location.href);

    // ── Step 1: Click "Nachricht schreiben" button on profile page ─────────
    // Only if we are NOT already in a conversation dialog
    const alreadyOpen = document.querySelector('[data-testid="chat-reply-input"]');
    if (!alreadyOpen) {
      log('Suche Nachricht-schreiben Button...');
      const msgBtn = await waitFor(() =>
        document.querySelector('[data-testid="btn_profile_sendmessage"]') ||
        [...document.querySelectorAll('[data-wry="Button"]')]
          .find(b => (b.innerText||'').toLowerCase().includes('nachricht'))
      , 8000);

      if (!msgBtn) {
        const btns = [...document.querySelectorAll('button')].map(b=>(b.innerText||'').trim()).filter(Boolean).slice(0,10);
        log('FEHLER: Kein Button. Buttons:', btns);
        return { ok: false, error: 'Kein Nachricht-Button. Buttons: ' + btns.join(' | ') };
      }

      log('Klicke Button:', msgBtn.innerText?.trim() || msgBtn.dataset.testid);
      msgBtn.click();
      await sleep(1000);
    } else {
      log('Dialog bereits offen');
    }

    // ── Step 2: Wait for the lightbox/dialog ───────────────────────────────
    log('Warte auf Dialog...');
    const textarea = await waitFor(() =>
      document.querySelector('textarea[data-testid="chat-reply-input"]')
    , 12000);

    if (!textarea) {
      log('FEHLER: Textarea nicht gefunden nach 12s');
      return { ok: false, error: 'Nachricht-Dialog hat sich nicht geöffnet' };
    }
    log('Dialog offen ✓');
    await sleep(500);

    // ── Step 3: Fill subject ───────────────────────────────────────────────
    const subjEl = document.querySelector('input[data-testid="subject-input"]');
    if (subjEl && subj) {
      log('Betreff eintragen...');
      subjEl.focus();
      await sleep(200);
      setNativeValue(subjEl, subj);
      await sleep(400);
      log('Betreff eingetragen ✓');
    }

    // ── Step 4: Fill message body ──────────────────────────────────────────
    log('Nachricht eintragen...');
    textarea.focus();
    await sleep(300);
    setNativeValue(textarea, msg);
    await sleep(600);
    log('Nachricht eingetragen ✓');

    // ── Step 5: Click send button ──────────────────────────────────────────
    log('Suche Senden-Button...');
    const sendBtn = await waitFor(() => {
      const btn = document.querySelector('button[data-testid="reply-button"]');
      if (btn && !btn.disabled) return btn;
      return null;
    }, 6000);

    if (!sendBtn) {
      // Check if button exists but is disabled
      const disabledBtn = document.querySelector('button[data-testid="reply-button"]');
      if (disabledBtn?.disabled) {
        log('Senden-Button ist disabled — Textarea nochmal triggern');
        textarea.focus();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('keyup', { bubbles: true }));
        await sleep(800);
        const retryBtn = document.querySelector('button[data-testid="reply-button"]:not([disabled])');
        if (!retryBtn) return { ok: false, error: 'Senden-Button bleibt disabled' };
        retryBtn.click();
        await sleep(2000);
        return { ok: true };
      }
      return { ok: false, error: 'Senden-Button nicht gefunden' };
    }

    log('Sende ✓');
    sendBtn.click();
    await sleep(2000);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FILL_AND_SEND') {
      fillAndSend(msg.message, msg.subject)
        .then(r => { log('Ergebnis:', r); sendResponse(r); })
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });

  log('Messenger v4 bereit');
})();

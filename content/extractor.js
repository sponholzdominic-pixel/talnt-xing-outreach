// talnt. XING TalentManager Kandidaten-Extraktor — präzise Selektoren
// Basiert auf echtem XING TalentManager HTML

function extractXingCandidates() {
  const results = [];
  const seen = new Set();

  // Jeder Kandidat hat eine div mit id="candidate_XXXXXXX"
  const candidateCards = document.querySelectorAll('div[id^="candidate_"]');

  candidateCards.forEach(card => {
    // Profil-Link & Name
    const nameLink = card.querySelector('a[data-testid="candidateFullName"]');
    if (!nameLink) return;

    const profileUrl = nameLink.href;
    const profileBase = profileUrl.split('?')[0];
    if (seen.has(profileBase)) return;
    seen.add(profileBase);

    const fullName = (nameLink.textContent || '').trim().replace(/\s+/g, ' ');
    if (!fullName) return;

    const parts = fullName.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    // Job-Titel: das <em> Element im Titel-Container
    const titleContainer = card.querySelector('.sc-gEkIjz, [class*="dsvFvF"]');
    let jobTitle = '';
    if (titleContainer) {
      // Titel steht in em oder direkt im div
      const em = titleContainer.querySelector('em');
      jobTitle = em ? (em.textContent || '').trim() : (titleContainer.textContent || '').trim();
      // Entferne Doppelslashes und extra Text
      jobTitle = jobTitle.replace(/\s+/g, ' ').trim();
    }

    // Firma: erste Span in der Firmen-Zeile
    const companySpan = card.querySelector('.sc-fFlnrN, [class*="loTAjD"]');
    const company = companySpan ? (companySpan.textContent || '').trim() : '';

    // Ort: zweite Span (ca-dVmw) in der Firmen-Zeile
    const locationContainer = card.querySelector('.sc-kbdlSk, [class*="edtRSh"]');
    let location = '';
    if (locationContainer) {
      const spans = locationContainer.querySelectorAll('span');
      spans.forEach(s => {
        const t = (s.textContent || '').trim();
        if (t.includes('Deutschland') || t.includes('Austria') || t.includes('Schweiz') ||
            t.match(/,\s*(Deutschland|Austria|Schweiz|DE|AT|CH)/) ||
            (!t.includes(' ') === false && t.length > 2 && t.length < 60 && t !== company)) {
          if (!location) location = t;
        }
      });
      // Fallback: letzter span
      if (!location) {
        const allSpans = [...locationContainer.querySelectorAll('span')];
        if (allSpans.length > 0) {
          location = (allSpans[allSpans.length-1].textContent || '').trim();
        }
      }
    }

    // Ausbildung aus dem aufgeklappten Bereich
    let education = '';
    const eduSection = card.querySelector('[data-testid="internal-content"]');
    if (eduSection) {
      const sections = eduSection.querySelectorAll('.sc-dChVcU, [class*="gInPiQ"]');
      sections.forEach(sec => {
        const label = sec.querySelector('.sc-rPWID, [class*="jlTEdn"]');
        if (label && (label.textContent || '').trim() === 'Ausbildung') {
          const eduTitle = sec.querySelector('.sc-jBeBSR, .sc-izQBue, [class*="fHdsHF"]');
          if (eduTitle) education = (eduTitle.textContent || '').trim();
        }
      });
    }

    results.push({
      name: fullName,
      firstName,
      lastName,
      jobTitle,
      company,
      location,
      education,
      profileUrl,
      profileBaseUrl: profileBase,
      status: 'pending',
      source: 'XING',
    });
  });

  console.log('[talnt.] Extrahiert:', results.length, 'Kandidaten');
  return results;
}

return extractXingCandidates();

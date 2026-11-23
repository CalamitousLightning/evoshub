/* EVOXERA Technology: official social links, one place.
   Add <script src="/socials.js" defer></script> to a page.
   - Any element with data-socials gets the links (optional data-title="...").
   - If a page has none, the links are added to its footer (.site-footer), when it has one.
   Change a URL here and every page follows. */
(function () {
  var LINKS = [
    { id: 'whatsapp', label: 'WhatsApp channel', url: 'https://whatsapp.com/channel/0029VaTrnsZEgGfFXkIcjt1M',
      svg: '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z"/><path d="M9 8.5c0 3.6 2.9 6.5 6.5 6.5l1-1.6-2-1-.9.9c-1-.4-1.9-1.300-2.300-2.300l.9-.9-1-2z"/>' },
    { id: 'x', label: 'X', url: 'https://x.com/EvoxeraTech',
      svg: '<path d="M4.500 4.500l15 15M19.500 4.500l-15 15"/>' },
    { id: 'telegram', label: 'Telegram', url: 'https://t.me/evoxera_technology',
      svg: '<path d="M21 4L3 11l5.500 2L10 19l3-3.500L18 19z"/><path d="M8.500 13L21 4"/>' }
  ];

  function injectStyle() {
    if (document.getElementById('evos-socials-css')) return;
    var s = document.createElement('style');
    s.id = 'evos-socials-css';
    s.textContent =
      '.evos-socials{display:flex;flex-direction:column;gap:10px;align-items:flex-start}' +
      '.evos-socials-title{font-size:12.5px;opacity:.7;letter-spacing:.02em}' +
      '.evos-socials-row{display:flex;flex-wrap:wrap;gap:8px}' +
      '.evos-socials a{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:999px;' +
      'border:1px solid var(--border,rgba(128,128,128,.35));color:var(--text2,inherit);background:var(--surface,transparent);' +
      'font-size:13px;line-height:1;text-decoration:none;transition:border-color .2s,color .2s}' +
      '.evos-socials a:hover,.evos-socials a:focus-visible{border-color:var(--blue,currentColor);color:var(--text,inherit)}' +
      '.evos-socials svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
      '.evos-socials-footer{max-width:var(--max-w,1100px);margin:0 auto 22px;padding:0 var(--gutter,20px)}';
    document.head.appendChild(s);
  }

  function build(title) {
    var box = document.createElement('div');
    box.className = 'evos-socials';
    if (title) {
      var t = document.createElement('div');
      t.className = 'evos-socials-title';
      t.textContent = title;
      box.appendChild(t);
    }
    var row = document.createElement('div');
    row.className = 'evos-socials-row';
    LINKS.forEach(function (l) {
      var a = document.createElement('a');
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', 'EVOXERA Technology on ' + (l.id === 'x' ? 'X' : l.label));
      a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + l.svg + '</svg>';
      var span = document.createElement('span');
      span.textContent = l.label;
      a.appendChild(span);
      row.appendChild(a);
    });
    box.appendChild(row);
    return box;
  }

  function init() {
    var spots = document.querySelectorAll('[data-socials]');
    injectStyle();
    if (spots.length) {
      Array.prototype.forEach.call(spots, function (el) {
        if (el.getAttribute('data-socials-ready')) return;
        el.setAttribute('data-socials-ready', '1');
        el.appendChild(build(el.getAttribute('data-title') || ''));
      });
      return;
    }
    var bottom = document.querySelector('.site-footer .site-footer__bottom');
    if (bottom && bottom.parentNode && !document.querySelector('.evos-socials-footer')) {
      var wrap = document.createElement('div');
      wrap.className = 'evos-socials-footer';
      wrap.appendChild(build('Follow EVOXERA Technology'));
      bottom.parentNode.insertBefore(wrap, bottom);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

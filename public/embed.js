/**
 * Papyrus — script d'intégration.
 *
 * À charger depuis la page qui héberge un formulaire Papyrus :
 *
 *   <iframe data-papyrus-src="https://…/embed/mon-formulaire?dynamicHeight=1"></iframe>
 *   <script src="https://…/embed.js" async></script>
 *
 * Il fait trois choses :
 *  · il pose la vraie `src` des iframes marquées `data-papyrus-src`, après avoir
 *    installé l'écoute — une iframe chargée trop tôt annoncerait sa hauteur dans
 *    le vide ;
 *  · il ajuste la hauteur des iframes qui le demandent ;
 *  · il ouvre le formulaire en fenêtre modale pour le mode « popup ».
 *
 * Aucune dépendance, aucun cookie, aucun appel réseau autre que le chargement du
 * formulaire lui-même.
 */
(function () {
  'use strict';

  if (window.__papyrusEmbedLoaded) return;
  window.__papyrusEmbedLoaded = true;

  var POPUP_SEEN_PREFIX = 'papyrus-popup-seen-';

  // --------------------------------------------------------------------------
  // Messages venus des iframes
  // --------------------------------------------------------------------------

  /**
   * On ne fait confiance qu'aux messages émis par une iframe que ce script a
   * lui-même créée : un message forgé par une autre iframe de la page ne doit
   * pas pouvoir redimensionner le formulaire ni déclencher un évènement.
   */
  function isKnownFrame(source) {
    var frames = document.querySelectorAll('iframe[data-papyrus-loaded]');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === source) return frames[i];
    }
    return null;
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== 'papyrus') return;

    var frame = isKnownFrame(event.source);
    if (!frame) return;

    if (data.type === 'resize' && typeof data.height === 'number') {
      if (frame.getAttribute('data-papyrus-fullpage') === '1') return;
      frame.style.height = Math.max(120, data.height) + 'px';
      frame.setAttribute('height', String(Math.max(120, data.height)));
      return;
    }

    // Évènements du formulaire : relayés à la page hôte, qui peut les brancher
    // sur son propre suivi. Deux canaux pour couvrir les deux usages courants.
    var detail = { type: data.type, formId: data.formId, slug: data.slug };

    window.dispatchEvent(new CustomEvent('papyrus:' + data.type, { detail: detail }));

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: 'papyrus_' + data.type.replace(/-/g, '_'), papyrus: detail });
    }

    if (data.type === 'form-submitted') {
      var popup = document.querySelector('.papyrus-popup-overlay');
      // Laisse le message de remerciement visible un instant avant de fermer.
      if (popup) window.setTimeout(function () { closePopup(popup); }, 2500);
    }
  });

  // --------------------------------------------------------------------------
  // Iframes intégrées
  // --------------------------------------------------------------------------

  function mountFrames() {
    var frames = document.querySelectorAll('iframe[data-papyrus-src]:not([data-papyrus-loaded])');

    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      frame.setAttribute('data-papyrus-loaded', '1');
      frame.style.border = 'none';
      frame.style.width = '100%';
      if (!frame.getAttribute('title')) frame.setAttribute('title', 'Formulaire');
      frame.src = frame.getAttribute('data-papyrus-src');
    }
  }

  // --------------------------------------------------------------------------
  // Mode popup
  // --------------------------------------------------------------------------

  function closePopup(overlay) {
    if (!overlay || !overlay.parentNode) return;
    overlay.parentNode.removeChild(overlay);
    document.body.style.overflow = overlay.getAttribute('data-previous-overflow') || '';
    if (overlay.__papyrusKeyHandler) {
      document.removeEventListener('keydown', overlay.__papyrusKeyHandler);
    }
    var opener = overlay.__papyrusOpener;
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  function openPopup(url, opener) {
    if (document.querySelector('.papyrus-popup-overlay')) return;

    var overlay = document.createElement('div');
    overlay.className = 'papyrus-popup-overlay';
    overlay.setAttribute('data-previous-overflow', document.body.style.overflow);
    overlay.__papyrusOpener = opener;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Formulaire');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:24px', 'background:rgba(5,33,57,.55)'
    ].join(';');

    var panel = document.createElement('div');
    panel.style.cssText = [
      'position:relative', 'width:100%', 'max-width:680px',
      'max-height:90vh', 'overflow:auto', 'background:#fff',
      'border-radius:20px', 'box-shadow:0 24px 60px rgba(5,33,57,.25)'
    ].join(';');

    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer le formulaire');
    close.innerHTML = '&times;';
    close.style.cssText = [
      'position:absolute', 'top:12px', 'right:12px', 'z-index:1',
      'width:32px', 'height:32px', 'border:none', 'border-radius:16px',
      'background:rgba(5,33,57,.06)', 'color:#052139',
      'font-size:22px', 'line-height:1', 'cursor:pointer'
    ].join(';');

    var frame = document.createElement('iframe');
    frame.setAttribute('data-papyrus-loaded', '1');
    frame.setAttribute('title', 'Formulaire');
    frame.style.cssText = 'display:block;width:100%;height:520px;border:none;';
    frame.src = url;

    close.addEventListener('click', function () { closePopup(overlay); });
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closePopup(overlay);
    });

    overlay.__papyrusKeyHandler = function (event) {
      if (event.key === 'Escape') closePopup(overlay);
    };
    document.addEventListener('keydown', overlay.__papyrusKeyHandler);

    panel.appendChild(close);
    panel.appendChild(frame);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    close.focus();
  }

  function alreadySeen(url) {
    try {
      return window.localStorage.getItem(POPUP_SEEN_PREFIX + url) === '1';
    } catch {
      return false;
    }
  }

  function markSeen(url) {
    try {
      window.localStorage.setItem(POPUP_SEEN_PREFIX + url, '1');
    } catch {
      /* Stockage indisponible : le popup se réaffichera, sans conséquence. */
    }
  }

  function mountPopups() {
    var triggers = document.querySelectorAll('[data-papyrus-popup]:not([data-papyrus-bound])');

    for (var i = 0; i < triggers.length; i++) {
      bindPopup(triggers[i]);
    }
  }

  function bindPopup(element) {
    element.setAttribute('data-papyrus-bound', '1');

    var url = element.getAttribute('data-papyrus-popup');
    var trigger = element.getAttribute('data-papyrus-trigger') || 'click';
    var once = element.getAttribute('data-papyrus-once') === '1';

    var launch = function () {
      if (once && alreadySeen(url)) return;
      if (once) markSeen(url);
      openPopup(url, element);
    };

    if (trigger === 'click') {
      element.addEventListener('click', function (event) {
        event.preventDefault();
        launch();
      });
      return;
    }

    // Les déclencheurs automatiques n'ont pas besoin d'un bouton visible.
    if (element.tagName === 'BUTTON' || element.tagName === 'A') {
      element.style.display = 'none';
    }

    if (trigger === 'time') {
      var delay = parseInt(element.getAttribute('data-papyrus-delay') || '3', 10);
      window.setTimeout(launch, Math.max(0, delay) * 1000);
      return;
    }

    if (trigger === 'scroll') {
      var percent = parseInt(element.getAttribute('data-papyrus-scroll') || '50', 10);
      var onScroll = function () {
        var scrollable = document.body.scrollHeight - window.innerHeight;
        if (scrollable <= 0) return;
        if ((window.scrollY / scrollable) * 100 < percent) return;
        window.removeEventListener('scroll', onScroll);
        launch();
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      return;
    }

    if (trigger === 'exit') {
      var onLeave = function (event) {
        if (event.clientY > 0) return;
        document.removeEventListener('mouseout', onLeave);
        launch();
      };
      document.addEventListener('mouseout', onLeave);
    }
  }

  // --------------------------------------------------------------------------
  // Démarrage
  // --------------------------------------------------------------------------

  function start() {
    mountFrames();
    mountPopups();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Les intégrations posées après coup (contenu chargé en Ajax, CMS headless)
  // sont prises en charge sans que la page ait à rappeler le script.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(start).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  window.Papyrus = window.Papyrus || {};
  window.Papyrus.openPopup = openPopup;
  window.Papyrus.refresh = start;
})();

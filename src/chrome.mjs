import { iconSvg } from './icons.mjs';
import { normalizeAppearance } from './palette.mjs';

const APPEARANCE_STORAGE_KEY = 'platform-atlas-appearance';

/** Presentation behavior for the workspace chrome. Domain state lives in app.mjs. */
export function createChrome({ onAppearance }) {
  const $ = (selector) => document.querySelector(selector);
  const main = $('#atlas-main');

  // Scene finish: an explicit ?look= wins on arrival, otherwise the saved choice.
  const finishButtons = [...document.querySelectorAll('button[data-appearance]')];
  const setAppearance = (value, persist = true) => {
    const look = normalizeAppearance(value);
    document.body.dataset.appearance = look;
    finishButtons.forEach((button) => button.setAttribute('aria-checked', String(button.dataset.appearance === look)));
    if (persist) {
      try { localStorage.setItem(APPEARANCE_STORAGE_KEY, look); } catch {}
      // Keep an explicit ?look= in step with the choice so a reload does not undo it.
      if (new URLSearchParams(location.search).has('look')) {
        const url = new URL(location.href);
        url.searchParams.set('look', look);
        history.replaceState(history.state, '', url);
      }
    }
    onAppearance?.(look);
  };
  let savedLook;
  try { savedLook = localStorage.getItem(APPEARANCE_STORAGE_KEY); } catch {}
  setAppearance(new URLSearchParams(location.search).get('look') ?? savedLook, false);
  finishButtons.forEach((button) => button.addEventListener('click', () => setAppearance(button.dataset.appearance)));

  // Source panel tabs follow the ARIA tabs pattern.
  const sourceTabs = [...document.querySelectorAll('.source-tabs [role="tab"]')];
  const setSourceTab = (selected, focus = false) => {
    sourceTabs.forEach((tab) => {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $(`#${tab.getAttribute('aria-controls')}`).hidden = !active;
    });
    if (focus) selected.focus();
  };
  sourceTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setSourceTab(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? sourceTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sourceTabs.length) % sourceTabs.length;
      setSourceTab(sourceTabs[next], true);
    });
  });

  // The call stepper lives in the walkthrough panel while it is open.
  const hud = $('#flow-hud');
  const hudHome = document.createComment('Call stepper home');
  hud.before(hudHome);
  const hopSlot = $('#atlas-hop-slot');

  // The chapter list is a disclosure that closes after a choice, on Escape, or outside.
  const chapters = $('#atlas-chapters');
  $('#journey-steps').addEventListener('click', (event) => {
    if (event.target.closest('[data-journey-step]')) chapters.open = false;
  });
  chapters.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    chapters.open = false;
    chapters.querySelector('summary').focus();
    event.stopPropagation();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!chapters.contains(event.target)) chapters.open = false;
  });

  const next = $('#journey-next');
  return {
    renderPanels({ showGuide, showInspector, isJourneyView }) {
      main.classList.toggle('is-reading', showGuide || showInspector || isJourneyView);
      main.classList.toggle('has-panel', showGuide || showInspector);
      if (showGuide && hud.parentElement !== hopSlot) hopSlot.append(hud);
      if (!showGuide && hud.parentElement === hopSlot) hudHome.after(hud);
    },
    renderJourney(journey, stepIndex) {
      $('#journey-heading').textContent = journey.shortLabel ?? journey.label;
      $('#atlas-chapter-position').textContent = `${stepIndex + 1} / ${journey.steps.length}`;
      $('#atlas-chapter-progress').replaceChildren(...journey.steps.map((_, index) => {
        const bar = document.createElement('span');
        bar.className = index === stepIndex ? 'is-current' : index < stepIndex ? 'is-complete' : '';
        return bar;
      }));
      const last = stepIndex === journey.steps.length - 1;
      next.innerHTML = `<span class="button-text">${last ? 'Walkthrough complete' : 'Next chapter'}</span>${last ? '' : iconSvg('arrow-right', { size: 18 })}`;
    },
    renderInteraction(mode) {
      $('#atlas-gesture').textContent = { pan: 'Drag to pan', orbit: 'Drag to orbit', arrange: 'Drag a tower to move' }[mode];
    },
  };
}

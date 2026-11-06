import { iconSvg, hasIcon } from './icons.mjs';

// Decorative icons enhance ordinary links; navigation works without JavaScript.
for (const element of document.querySelectorAll('[data-icon]')) {
  const name = element.dataset.icon;
  if (hasIcon(name)) element.innerHTML = iconSvg(name, { size: 22 });
}

// Keep the repository name and a real Phosphor glyph readable while art loads.
for (const image of document.querySelectorAll('.repository-art img')) {
  const update = () => image.parentElement.classList.toggle('has-art', image.naturalWidth > 0);
  image.addEventListener('load', update);
  image.addEventListener('error', update);
  if (image.complete) update();
}

const preview = document.querySelector('#atlas-preview-image');
if (preview) {
  const hideUnavailablePreview = () => {
    preview.hidden = true;
    preview.closest('.atlas-preview').classList.add('preview-unavailable');
  };
  preview.addEventListener('error', hideUnavailablePreview);
  if (preview.complete && !preview.naturalWidth) hideUnavailablePreview();
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const animations = new Set();
let observer;

function reveal(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    if (reducedMotion.matches || typeof entry.target.animate !== 'function') continue;
    const animation = entry.target.animate(
      [{ opacity: 0.5, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 460, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
  }
}

if ('IntersectionObserver' in window && !reducedMotion.matches) {
  observer = new IntersectionObserver(reveal, { threshold: 0.12 });
  document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));
}

reducedMotion.addEventListener('change', () => {
  if (!reducedMotion.matches) return;
  observer?.disconnect();
  animations.forEach((animation) => animation.cancel());
  animations.clear();
});

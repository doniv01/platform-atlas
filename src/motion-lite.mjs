/**
 * Dependency-free motion helpers for Platform Atlas.
 * Safe for static GitHub Pages (no bare package imports like "motion").
 */

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {Record<string, number>} from
 * @param {Record<string, number>} to
 * @param {{ duration?: number, ease?: 'out' | 'inout', onUpdate?: Function, onComplete?: Function }} options
 */
export function animateObject(from, to, options = {}) {
  const duration = options.duration ?? 900;
  const ease = options.ease === 'inout' ? easeInOutCubic : easeOutCubic;
  const keys = Object.keys(to);
  const start = Object.fromEntries(keys.map((key) => [key, Number(from[key] ?? to[key])]));

  if (prefersReducedMotion() || duration <= 0) {
    options.onUpdate?.({ ...to });
    options.onComplete?.();
    return { stop() {} };
  }

  let frameId = 0;
  let stopped = false;
  const startedAt = performance.now();

  const tick = (now) => {
    if (stopped) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = ease(progress);
    const next = {};
    keys.forEach((key) => {
      next[key] = start[key] + (to[key] - start[key]) * eased;
    });
    options.onUpdate?.(next);
    if (progress < 1) {
      frameId = requestAnimationFrame(tick);
      return;
    }
    options.onComplete?.();
  };

  frameId = requestAnimationFrame(tick);
  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(frameId);
    },
  };
}

/**
 * @param {Element | Element[] | string} target
 * @param {Record<string, unknown>} keyframes
 * @param {Record<string, unknown>} [options]
 */
export function animateUi(target, keyframes, options = {}) {
  if (prefersReducedMotion()) return null;
  const nodes = typeof target === 'string'
    ? [...document.querySelectorAll(target)]
    : Array.isArray(target)
      ? target
      : [target];

  const durationMs = Math.round((options.duration ?? 0.55) * 1000);
  const delayMs = Math.round((options.delay ?? 0) * 1000);
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return;
    // WAAPI doesn't leave inline transforms behind or overwrite layout centering.
    uiAnimations.get(node)?.cancel();
    const frames = [0, 1].map((index) => {
      const frame = {};
      for (const [property, value] of Object.entries(keyframes)) {
        const at = Array.isArray(value) ? value[index === 0 ? 0 : value.length - 1] : value;
        if (property === 'y') frame.transform = `translateY(${at}px)`;
        else if (property === 'scale') frame.scale = String(at);
        else frame[property] = at;
      }
      return frame;
    });
    const animation = node.animate(frames, { duration: durationMs, delay: delayMs, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
    uiAnimations.set(node, animation);
    animation.finished.then(() => uiAnimations.delete(node)).catch(() => {});
  });
  return null;
}

const uiAnimations = new WeakMap();

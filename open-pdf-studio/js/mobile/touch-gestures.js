import { setZoom, fitWidth, fitPage, goToPage } from '../pdf/renderer.js';
import { state } from '../core/state.js';

/**
 * Initialize pinch-to-zoom on a container element.
 * Tracks two-finger touch events and applies zoom changes.
 */
export function initPinchZoom(container) {
  let initialDistance = 0;
  let initialScale = 1;
  let isPinching = false;

  function getDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      isPinching = true;
      initialDistance = getDistance(e.touches);
      initialScale = state.scale;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!isPinching || e.touches.length !== 2) return;

    const currentDistance = getDistance(e.touches);
    const ratio = currentDistance / initialDistance;
    let newScale = initialScale * ratio;

    // Clamp between 0.25 and 5.0
    newScale = Math.max(0.25, Math.min(5.0, newScale));

    // Apply CSS transform for instant visual feedback
    const canvasWrapper = container.querySelector('#canvas-wrapper');
    if (canvasWrapper) {
      const visualRatio = newScale / state.scale;
      canvasWrapper.style.transform = `scale(${visualRatio})`;
      canvasWrapper.style.transformOrigin = 'center center';
    }
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (!isPinching) return;

    if (e.touches.length < 2) {
      isPinching = false;

      // Calculate final scale
      const canvasWrapper = container.querySelector('#canvas-wrapper');
      if (canvasWrapper) {
        const currentTransform = canvasWrapper.style.transform;
        const match = currentTransform.match(/scale\(([\d.]+)\)/);
        if (match) {
          let newScale = state.scale * parseFloat(match[1]);
          newScale = Math.max(0.25, Math.min(5.0, newScale));

          // Reset CSS transform
          canvasWrapper.style.transform = '';
          canvasWrapper.style.transformOrigin = '';

          // Apply proper re-render at new scale
          setZoom(newScale);
        } else {
          canvasWrapper.style.transform = '';
          canvasWrapper.style.transformOrigin = '';
        }
      }
    }
  }, { passive: true });
}

/**
 * Initialize swipe left/right to change pages.
 * A horizontal single-finger swipe (>80px, mostly horizontal) triggers navigation.
 * Swipe left = next page, swipe right = previous page.
 */
export function initSwipeNavigation(container) {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    tracking = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    // If two fingers appear, cancel swipe tracking (it's a pinch)
    if (e.touches.length !== 1) {
      tracking = false;
    }
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;

    if (e.changedTouches.length !== 1) return;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - startX;
    const dy = endY - startY;
    const elapsed = Date.now() - startTime;

    // Must be a quick gesture (<400ms), mostly horizontal, and >80px distance
    if (elapsed > 400) return;
    if (Math.abs(dx) < 80) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.6) return;

    const numPages = state.pdfDoc?.numPages || 0;
    if (!numPages) return;

    // In RTL layout, swipe directions are reversed
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    const nextSwipe = rtl ? dx > 0 : dx < 0;
    const prevSwipe = rtl ? dx < 0 : dx > 0;

    if (nextSwipe && state.currentPage < numPages) {
      goToPage(state.currentPage + 1);
    } else if (prevSwipe && state.currentPage > 1) {
      goToPage(state.currentPage - 1);
    }
  }, { passive: true });
}

/**
 * Initialize double-tap to fit width on a container element.
 * Detects two taps within 300ms in the same general area.
 * Toggles between fit-width and fit-page.
 */
export function initDoubleTap(container) {
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let isFitWidth = false;

  container.addEventListener('touchend', (e) => {
    // Only handle single-finger taps
    if (e.changedTouches.length !== 1 || e.touches.length > 0) return;

    const touch = e.changedTouches[0];
    const now = Date.now();
    const timeDiff = now - lastTapTime;
    const dx = Math.abs(touch.clientX - lastTapX);
    const dy = Math.abs(touch.clientY - lastTapY);

    if (timeDiff < 300 && dx < 40 && dy < 40) {
      // Double tap detected
      e.preventDefault();
      if (isFitWidth) {
        fitPage();
        isFitWidth = false;
      } else {
        fitWidth();
        isFitWidth = true;
      }
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX = touch.clientX;
      lastTapY = touch.clientY;
    }
  }, { passive: false });
}

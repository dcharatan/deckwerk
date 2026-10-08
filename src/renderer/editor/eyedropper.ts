/**
 * Pick a colour from anywhere on screen.
 *
 * The desktop editor asks the main process for a capture of its window and
 * shows that capture with a loupe of its own — a magnified grid of the pixels
 * under the pointer with the sampled one outlined, the way Figma's picker
 * shows them. The window is still while a colour is being picked, so a still
 * of it is exactly what the person is looking at. Electron *exposes*
 * Chromium's `EyeDropper` but has nothing behind it — `open()` rejects at once
 * as if cancelled — so the capture is preferred wherever the host offers one.
 * The browser editor has no capture and uses Chromium's `EyeDropper`, which
 * samples the whole screen and draws its own magnifying loupe.
 */

type NativeEyeDropper = new () => { open: () => Promise<{ sRGBHex: string }> };

/** How many screen pixels the loupe shows on each side; odd, so one is centred. */
const LOUPE_PIXELS = 11;
/** How large each of them is drawn, in CSS pixels. */
const LOUPE_ZOOM = 12;

function nativeEyeDropper(): NativeEyeDropper | null {
  return (window as Window & { EyeDropper?: NativeEyeDropper }).EyeDropper ?? null;
}

function canCapture(): boolean {
  return typeof (window.api as { captureWindow?: unknown } | undefined)?.captureWindow === 'function';
}

/** Whether this editor can pick colours from the screen at all. */
export function eyedropperAvailable(): boolean {
  return nativeEyeDropper() !== null || canCapture();
}

/**
 * Let the person click a pixel; resolves its colour as `#rrggbb`, or null if
 * they cancelled (Escape, right-click) or the screen could not be read.
 * `hide` is put out of sight first, so the picker that asked is not itself
 * in the way of what it is picking from.
 */
export async function pickScreenColor(hide?: HTMLElement | null): Promise<string | null> {
  const native = nativeEyeDropper();
  if (!canCapture()) {
    if (!native) return null;
    try {
      return (await new native().open()).sRGBHex;
    } catch {
      // Escape is a cancel; an OS that cannot sample is the same to the person.
      return null;
    }
  }
  const restore = hide?.style.visibility ?? '';
  if (hide) hide.style.visibility = 'hidden';
  try {
    // Two frames: the first paints the hidden popover, the second is captured.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const url = await window.api.captureWindow();
    if (!url) return null;
    const image = new Image();
    image.src = url;
    await image.decode();
    return await pickFromStill(image);
  } catch {
    return null;
  } finally {
    if (hide) hide.style.visibility = restore;
  }
}

/** Show `still` over the whole window and let the person pick a pixel of it. */
function pickFromStill(still: HTMLImageElement): Promise<string | null> {
  const pixels = document.createElement('canvas');
  pixels.width = still.naturalWidth;
  pixels.height = still.naturalHeight;
  const source = pixels.getContext('2d', { willReadFrequently: true })!;
  source.drawImage(still, 0, 0);
  // The capture is in device pixels; the pointer is in CSS pixels.
  const ratio = still.naturalWidth / window.innerWidth;

  const overlay = document.createElement('div');
  overlay.className = 'eyedropper-overlay';
  overlay.style.backgroundImage = `url("${still.src}")`;
  const loupe = document.createElement('div');
  loupe.className = 'eyedropper-loupe';
  const lens = document.createElement('canvas');
  const side = LOUPE_PIXELS * LOUPE_ZOOM;
  lens.width = side * devicePixelRatio;
  lens.height = side * devicePixelRatio;
  lens.style.width = `${side}px`;
  lens.style.height = `${side}px`;
  const readout = document.createElement('span');
  readout.className = 'eyedropper-readout';
  loupe.append(lens, readout);
  overlay.appendChild(loupe);
  document.body.appendChild(overlay);
  const view = lens.getContext('2d')!;
  view.imageSmoothingEnabled = false;

  const sample = (clientX: number, clientY: number): string => {
    const x = Math.max(0, Math.min(pixels.width - 1, Math.floor(clientX * ratio)));
    const y = Math.max(0, Math.min(pixels.height - 1, Math.floor(clientY * ratio)));
    const [r, g, b] = source.getImageData(x, y, 1, 1).data;
    return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  };

  const draw = (clientX: number, clientY: number): void => {
    const half = (LOUPE_PIXELS - 1) / 2;
    const cx = Math.floor(clientX * ratio);
    const cy = Math.floor(clientY * ratio);
    const scale = devicePixelRatio * LOUPE_ZOOM;
    view.setTransform(1, 0, 0, 1, 0, 0);
    view.fillStyle = '#000';
    view.fillRect(0, 0, lens.width, lens.height);
    view.drawImage(pixels, cx - half, cy - half, LOUPE_PIXELS, LOUPE_PIXELS, 0, 0, lens.width, lens.height);
    // A faint grid separates the pixels; the sampled one is outlined.
    view.strokeStyle = 'rgb(128 128 128 / 35%)';
    view.lineWidth = 1;
    for (let i = 1; i < LOUPE_PIXELS; i++) {
      view.beginPath();
      view.moveTo(i * scale + 0.5, 0);
      view.lineTo(i * scale + 0.5, lens.height);
      view.moveTo(0, i * scale + 0.5);
      view.lineTo(lens.width, i * scale + 0.5);
      view.stroke();
    }
    view.lineWidth = 2 * devicePixelRatio;
    view.strokeStyle = '#fff';
    view.strokeRect(half * scale, half * scale, scale, scale);
    view.lineWidth = devicePixelRatio;
    view.strokeStyle = '#000';
    view.strokeRect(half * scale - devicePixelRatio, half * scale - devicePixelRatio, scale + 2 * devicePixelRatio, scale + 2 * devicePixelRatio);
    const hex = sample(clientX, clientY);
    readout.textContent = hex;
    readout.style.setProperty('--sampled', hex);
    // Beside the pointer, flipped to stay on screen near the right and bottom edges.
    const gap = 18;
    const box = loupe.getBoundingClientRect();
    const left = clientX + gap + box.width > window.innerWidth ? clientX - gap - box.width : clientX + gap;
    const top = clientY + gap + box.height > window.innerHeight ? clientY - gap - box.height : clientY + gap;
    loupe.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px)`;
  };

  return new Promise((resolve) => {
    const finish = (value: string | null): void => {
      overlay.remove();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPress, true);
      resolve(value);
    };
    // Taken at the window, ahead of every document listener: the click that
    // picks must not also count as a click outside the picker that asked,
    // which would close it.
    const onPress = (event: PointerEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(event.button === 0 ? sample(event.clientX, event.clientY) : null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };
    overlay.addEventListener('pointermove', (event) => draw(event.clientX, event.clientY));
    window.addEventListener('pointerdown', onPress, true);
    overlay.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('keydown', onKey, true);
    loupe.style.visibility = 'hidden';
    overlay.addEventListener('pointermove', () => { loupe.style.visibility = ''; }, { once: true });
  });
}

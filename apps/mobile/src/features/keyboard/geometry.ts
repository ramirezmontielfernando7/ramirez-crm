export type Rect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
/** Screen-space intersection. A resized Android window already above the IME needs zero padding. */
export function keyboardOverlap(view: Rect, keyboard: Rect | null) {
  if (
    !keyboard ||
    ![
      view.x,
      view.y,
      view.width,
      view.height,
      keyboard.x,
      keyboard.y,
      keyboard.width,
      keyboard.height,
    ].every(Number.isFinite) ||
    view.width <= 0 ||
    view.height <= 0 ||
    keyboard.width <= 0 ||
    keyboard.height <= 0 ||
    keyboard.y <= 0
  )
    return 0;
  const horizontal =
    Math.min(view.x + view.width, keyboard.x + keyboard.width) -
    Math.max(view.x, keyboard.x);
  // Floating/split keyboards must not collapse the entire page. Focus scrolling still handles inputs.
  if (horizontal < view.width * 0.75) return 0;
  return Math.max(0, Math.min(view.height, view.y + view.height - keyboard.y));
}
/** Minimum scroll delta, in screen coordinates; visible inputs never snap to scroll offset zero. */
export function revealScrollDelta(
  input: Rect,
  viewport: Rect,
  keyboard: Rect | null,
  gap = 12,
) {
  if (
    ![
      input.x,
      input.y,
      input.width,
      input.height,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
      gap,
    ].every(Number.isFinite) ||
    viewport.height <= 0 ||
    input.height <= 0
  )
    return 0;
  let bottom = viewport.y + viewport.height;
  if (
    keyboard &&
    keyboard.height > 0 &&
    keyboard.y > 0 &&
    input.x < keyboard.x + keyboard.width &&
    input.x + input.width > keyboard.x
  )
    bottom = Math.min(bottom, keyboard.y);
  const top = viewport.y + Math.max(0, gap);
  bottom -= Math.max(0, gap);
  if (input.height > bottom - top) return input.y - top;
  if (input.y < top) return input.y - top;
  return Math.max(0, input.y + input.height - bottom);
}

import type { SlideElement } from '@shared/deck.js';
import type { EditorStore } from './store.js';

export type ArrangeDirection = 'front' | 'forward' | 'backward' | 'back';

/** What each direction is called in menus, hints and the undo history. */
export const ARRANGE_LABELS: Record<ArrangeDirection, string> = {
  front: 'Bring to front',
  forward: 'Bring forward',
  backward: 'Send backward',
  back: 'Send to back',
};

/**
 * Restack `elements` (one slide's) so the `selected` ones move in paint order:
 * one step past the next unselected object for forward/backward, or as a block
 * to the top/bottom for front/back. Selected objects keep their order among
 * themselves. Paint order is `z`, ties broken by position in the array, as the
 * renderer draws them; when anything moved, the slide's `z` values are
 * renumbered 1…n in the new order, so no two objects tie afterwards. Returns
 * whether anything moved.
 */
export function arrangeElements(
  elements: SlideElement[],
  selected: ReadonlySet<string>,
  direction: ArrangeDirection,
): boolean {
  const order = elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
    .map(({ element }) => element);
  const isSelected = (element: SlideElement): boolean => selected.has(element.id);
  let next: SlideElement[];
  if (direction === 'front') {
    next = [...order.filter((e) => !isSelected(e)), ...order.filter(isSelected)];
  } else if (direction === 'back') {
    next = [...order.filter(isSelected), ...order.filter((e) => !isSelected(e))];
  } else {
    next = [...order];
    // Walk from the end being moved towards, so a selected run moves together.
    if (direction === 'forward') {
      for (let i = next.length - 2; i >= 0; i--) {
        if (isSelected(next[i]) && !isSelected(next[i + 1])) {
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
        }
      }
    } else {
      for (let i = 1; i < next.length; i++) {
        if (isSelected(next[i]) && !isSelected(next[i - 1])) {
          [next[i], next[i - 1]] = [next[i - 1], next[i]];
        }
      }
    }
  }
  if (next.every((element, i) => element === order[i])) return false;
  next.forEach((element, i) => { element.z = i + 1; });
  return true;
}

/** Restack the store's selected objects on the current slide, as one undoable edit. */
export function arrangeSelection(store: EditorStore, direction: ArrangeDirection): void {
  const { slideIndex, selection } = store.get();
  if (selection.size === 0) return;
  store.commit((deck) => {
    const slide = deck.slides[slideIndex];
    if (slide) arrangeElements(slide.elements, selection, direction);
  }, { label: ARRANGE_LABELS[direction] });
}

import '@testing-library/jest-dom/vitest';

// jsdom has no layout engine, so Range/Element client-rect APIs are missing -
// ProseMirror's view (scrollIntoView, coordsAtPos) calls these during every
// transaction dispatch and throws without this polyfill.
const rectStub = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON() {
    return this;
  },
};
Range.prototype.getClientRects = () => [rectStub] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rectStub as DOMRect;
Element.prototype.getClientRects = () => [rectStub] as unknown as DOMRectList;
Element.prototype.getBoundingClientRect = () => rectStub as DOMRect;

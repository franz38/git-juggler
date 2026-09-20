// A 1x1 transparent GIF used to suppress the browser's default native drag
// image (the semi-transparent element snapshot that follows the cursor
// during HTML5 drag-and-drop) -- we already show drag feedback via a
// `dragging` class on the source element itself, so the native ghost is
// redundant and, per user request, unwanted.
const TRANSPARENT_PIXEL = new Image();
TRANSPARENT_PIXEL.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export function suppressDragImage(event: DragEvent): void {
  event.dataTransfer?.setDragImage(TRANSPARENT_PIXEL, 0, 0);
}

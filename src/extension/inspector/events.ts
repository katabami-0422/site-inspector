export const inspectorBus = new EventTarget();

export function toggleInspector() {
  inspectorBus.dispatchEvent(new Event("toggle"));
}

// Minimal DOM helper.

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((ev: Event) => void)> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs !== null) {
    const names = Object.keys(attrs);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const value = attrs[name];
      if (typeof value === 'function') {
        node.addEventListener(name.slice(2), value);
      } else if (typeof value === 'boolean') {
        if (value) node.setAttribute(name, '');
      } else if (name === 'class') {
        node.className = value;
      } else {
        node.setAttribute(name, value);
      }
    }
  }
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function percent(p: number): string {
  const v = Math.round(p * 100);
  if (p > 0 && v === 0) return '1%未満';
  return `${v}%`;
}

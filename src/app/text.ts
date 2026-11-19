// Small wording helpers shared by the screens.

// "都内" / "道内" / "府内" / "県内", matching the prefecture's own suffix.
export function insidePref(prefName: string): string {
  const last = prefName.slice(-1);
  if (last === '都' || last === '道' || last === '府') return `${last}内`;
  return '県内';
}

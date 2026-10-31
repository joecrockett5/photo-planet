type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

type TagOf<S extends string> = S extends `${infer T}.${string}` ? T : S;
type ElementOf<S extends string> = TagOf<S> extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[TagOf<S>]
  : HTMLElement;

/** Tiny element builder: h('button.close', { onclick }, 'x'). */
export function h<S extends string>(
  tag: S,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): ElementOf<S> {
  const [name, ...classes] = tag.split('.') as [string, ...string[]];
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el as ElementOf<S>;
}

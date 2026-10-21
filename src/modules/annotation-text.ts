// Frozen v1: rendered article.textContent, without whitespace or Unicode normalization.
export const annotationTextVersion = 'p1-markdown-dom-v1';
export type Anchor = { start: number; end: number; quote: string; prefix: string; suffix: string };
const excluded = 'img,button,input,textarea,select,form,[data-annotation-exclude]';

export function textAnchor(plainText: string, start: unknown, end: unknown, version = annotationTextVersion): Anchor {
  if (version !== annotationTextVersion) throw new Error('此版本的定位规则暂不支持，请通过原引用与版本入口阅读。');
  const chars = Array.from(plainText);
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > chars.length) throw new Error('选中文字范围无效。');
  const quote = chars.slice(start, end).join('');
  if (!quote.trim()) throw new Error('请选择包含实际文字的范围。');
  return { start, end, quote, prefix: chars.slice(Math.max(0, start - 24), start).join(''), suffix: chars.slice(end, end + 24).join('') };
}
function utf16Boundary(text: string, offset: number) {
  return Number.isInteger(offset) && offset >= 0 && offset <= text.length && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}
export function domPointOffset(root: HTMLElement, target: Node, offset: number): number {
  if (!root.contains(target)) throw new Error('只能在正文区域选择文字。');
  let prefix = '', found = false;
  function visit(node: Node) {
    if (found) return;
    if (node === target) {
      if (node.nodeType === 3) {
        const value = node.textContent || '';
        if (!utf16Boundary(value, offset)) throw new Error('选区边界不能截断一个 Unicode 字符。');
        prefix += value.slice(0, offset);
      } else {
        if (!Number.isInteger(offset) || offset < 0 || offset > node.childNodes.length) throw new Error('选区边界无效。');
        for (let i = 0; i < offset; i++) prefix += node.childNodes[i].textContent || '';
      }
      found = true; return;
    }
    if (node.nodeType === 3) prefix += node.textContent || '';
    else for (const child of Array.from(node.childNodes)) { visit(child); if (found) break; }
  }
  visit(root);
  if (!found) throw new Error('找不到选区边界。');
  return Array.from(prefix).length;
}
function verifyDOM(root: HTMLElement, plainText: string) {
  if (root.textContent !== plainText) throw new Error('本页文字与发布版本不一致，保留引用但不猜测定位。');
}
function allowedRange(root: HTMLElement, range: Range) {
  for (const element of root.querySelectorAll(excluded)) if (range.intersectsNode(element)) throw new Error('选区不能包含图片、按钮或表单。');
}
export function rangeAnchor(root: HTMLElement, range: Range, plainText: string, version: string): Anchor {
  verifyDOM(root, plainText);
  if (range.collapsed) throw new Error('请先在正文选择一段文字。');
  const result = textAnchor(plainText, domPointOffset(root, range.startContainer, range.startOffset), domPointOffset(root, range.endContainer, range.endOffset), version);
  allowedRange(root, range); return result;
}
export function anchorRange(root: HTMLElement, anchor: Pick<Anchor, 'start' | 'end' | 'quote'>, plainText: string, version: string): Range {
  verifyDOM(root, plainText);
  const verified = textAnchor(plainText, anchor.start, anchor.end, version);
  if (verified.quote !== anchor.quote) throw new Error('引用与发布版本不一致，无法准确定位。');
  const range = root.ownerDocument.createRange(), walker = root.ownerDocument.createTreeWalker(root, 4);
  let offset = 0, node: Node | null, began = false, ended = false;
  while ((node = walker.nextNode())) {
    const chars = Array.from(node.textContent || ''), next = offset + chars.length;
    if (!began && anchor.start < next) { range.setStart(node, chars.slice(0, anchor.start - offset).join('').length); began = true; }
    if (began && anchor.end <= next) { range.setEnd(node, chars.slice(0, anchor.end - offset).join('').length); ended = true; break; }
    offset = next;
  }
  if (!began || !ended) throw new Error('找不到引用范围。');
  allowedRange(root, range); return range;
}
export function findQuoteRanges(plainText: string, quote: string, page = 1) {
  if (!quote.trim() || quote.length > 5000 || !Number.isSafeInteger(page) || page < 1) throw new Error('请填写 1–5,000 字符的原文引用。');
  const offsets = new Map<number, number>(); let utf16 = 0, point = 0;
  offsets.set(0, 0); for (const char of plainText) { utf16 += char.length; offsets.set(utf16, ++point); }
  let from = 0, count = 0; const items: Anchor[] = [];
  while (from <= plainText.length) {
    const index = plainText.indexOf(quote, from); if (index < 0) break;
    const start = offsets.get(index), end = offsets.get(index + quote.length);
    if (start !== undefined && end !== undefined) {
      if (count >= (page - 1) * 10 && items.length < 10) items.push(textAnchor(plainText, start, end));
      count++;
    }
    from = index + (plainText.codePointAt(index)! > 0xffff ? 2 : 1);
  }
  return { items, total: count, pages: Math.max(1, Math.ceil(count / 10)) };
}
export function annotationHref(path: string, version: string, annotation: number, comment: number, target = 'body') {
  return `${path}?version=${encodeURIComponent(version)}&annotation=${annotation}&thread=${comment}#${target === 'discussion' ? 'discussion' : 'annotation-body'}`;
}

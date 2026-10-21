import crypto from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { parseHTML } from 'linkedom';
import { APIError } from 'payload';
import { annotationTextVersion } from './annotation-text';

export const rendererVersion = annotationTextVersion;
export function verifyAnnotationText(html: string, plainText: string, start: number, end: number) {
  const { document } = parseHTML(`<html><body><article>${html}</article></body></html>`), root = document.querySelector('article')!;
  if (root.textContent !== plainText) throw new APIError('发布版本的正文与定位文本不一致，不能创建批注。', 409);
  let offset = 0;
  function visit(node: Node) {
    if (node.nodeType === 3) { offset += Array.from(node.textContent || '').length; return; }
    const element = node as Element;
    if (element.matches?.('img,button,input,textarea,select,form,[data-annotation-exclude]')) {
      const length = Array.from(element.textContent || '').length;
      if (length ? start < offset + length && end > offset : start < offset && end > offset) throw new APIError('选区不能跨越图片、按钮或表单。', 400);
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  }
  visit(root as unknown as Node);
}
export function imageIds(markdown: string): number[] {
  const md = new MarkdownIt({ html: false });
  const ids: number[] = [];
  for (const token of md.parse(markdown, {})) for (const child of token.children || []) {
    if (child.type !== 'image') continue;
    const match = /^media:([1-9]\d*)$/.exec(String(child.attrGet('src') || ''));
    if (!match || !child.content.trim()) throw new APIError('图片必须使用本站 media:ID 并填写替代文字。', 400);
    ids.push(Number(match[1]));
  }
  return [...new Set(ids)];
}
export function renderMarkdown(markdown: string, media: Map<number, string>) {
  const md = new MarkdownIt({ html: false });
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const id = Number(String(tokens[index].attrGet('src')).slice(6));
    const url = media.get(id);
    if (!url) throw new APIError('图片引用不可用。', 400);
    tokens[index].attrSet('src', url);
    tokens[index].attrSet('loading', 'lazy');
    return image(tokens, index, options, env, self);
  };
  imageIds(markdown);
  const html = md.render(markdown);
  const { document } = parseHTML(`<html><body><article>${html}</article></body></html>`);
  const plainText = document.querySelector('article')!.textContent || '';
  return { html, plainText, rendererVersion, bodyHash: crypto.createHash('sha256').update(markdown).digest('hex') };
}

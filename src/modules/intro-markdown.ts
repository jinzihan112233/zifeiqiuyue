import MarkdownIt from 'markdown-it';

/** User-supplied introduction text: Markdown formatting, never raw HTML. */
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false });
markdown.disable('image');

export function renderIntroMarkdown(value: string) {
  return markdown.render(value);
}

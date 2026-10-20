(function () {
  'use strict';
  const data = window.SITE_DATA;
  const articles = data.articles.slice().sort((a, b) => b.published.localeCompare(a.published));
  const $ = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const hrefFor = article => 'read.html?id=' + encodeURIComponent(article.id);
  const displayDate = value => value.replace(/-/g, '.');

  function initHome() {
    const list = document.getElementById('featured-list');
    for (const id of data.featuredIds) {
      const article = articles.find(item => item.id === id);
      if (!article) continue;
      const card = $('a', 'article-card');
      card.href = hrefFor(article);
      card.append($('span', 'article-label', article.type));
      card.append($('h3', '', article.title));
      card.append($('p', 'article-description', article.description));
      const bottom = $('div', 'article-card-bottom');
      const date = $('time', '', displayDate(article.published) + (article.demo ? ' · 演示' : ''));
      date.dateTime = article.published;
      bottom.append(date);
      const arrow = $('span', 'article-arrow', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      bottom.append(arrow);
      card.append(bottom);
      list.append(card);
    }
    const quotes = document.getElementById('quotes-list');
    for (const quote of data.quotes) {
      const block = $('blockquote', 'quote-item');
      block.append($('p', '', quote.text));
      const cite = $('cite', '', '— ' + quote.attribution + (quote.demo ? ' · 演示' : ''));
      if (quote.articleId || quote.sourceUrl) {
        const link = $('a', '', cite.textContent);
        link.href = quote.articleId ? hrefFor({ id: quote.articleId }) : quote.sourceUrl;
        cite.replaceChildren(link);
      }
      block.append(cite);
      quotes.append(block);
    }
  }

  function initArticles() {
    const list = document.getElementById('archive-list');
    articles.forEach((article) => {
      const item = $('a', 'archive-item');
      item.href = hrefFor(article);
      const content = $('div', 'archive-content');
      content.append($('h2', '', article.title));
      item.append(content);
      const date = $('time', 'archive-date', displayDate(article.published) + (article.demo ? ' · 演示' : ''));
      date.dateTime = article.published;
      item.append(date);
      const arrow = $('span', 'archive-arrow', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      item.append(arrow);
      list.append(item);
    });
  }

  function initReader() {
    const id = new URLSearchParams(window.location.search).get('id');
    const article = articles.find(item => item.id === id);
    const root = document.getElementById('reader');
    if (!article) {
      root.append($('h1', 'reader-title', '未找到文章'));
      const back = $('a', 'reader-source', '返回全部文章');
      back.href = 'articles.html';
      root.append(back);
      return;
    }
    document.title = article.title + ' · 子非秋月 · 为您讲述';
    const head = $('header', 'reader-heading');
    head.append($('span', 'section-kicker', article.type));
    head.append($('h1', 'reader-title', article.title));
    const date = $('time', 'reader-date', displayDate(article.published) + (article.demo ? ' · 示例日期' : ' · 原视频发布日期'));
    date.dateTime = article.published;
    head.append(date);
    if (article.demo) head.append($('p', 'demo-note', '演示文章 · 以下文字为虚构排版示例，并非子非秋月原文。'));
    root.append(head);
    const body = $('article', 'reader-body');
    // HTML 只来自关闭原生 HTML 解析的 Markdown 构建，不接收页面输入。
    body.innerHTML = article.html;
    root.append(body);
    if (article.sourceUrl) {
      const a = $('a', 'reader-source', '原视频来源 ↗');
      a.href = article.sourceUrl;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      root.append(a);
    }
  }

  const page = document.body.dataset.page;
  if (page === 'home') initHome();
  if (page === 'articles') initArticles();
  if (page === 'read') initReader();
})();

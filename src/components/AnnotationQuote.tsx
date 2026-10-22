'use client';
import { useState } from 'react';
import { previewAnnotationQuote } from '../modules/annotation-groups';

export function AnnotationQuote({ quote }: { quote: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = previewAnnotationQuote(quote);
  return <div className="annotation-quote">
    <blockquote>{expanded || !preview.truncated ? quote : preview.text}</blockquote>
    {preview.truncated && <button type="button" className="annotation-quote-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? '收起原文' : '展开原文'}
    </button>}
  </div>;
}

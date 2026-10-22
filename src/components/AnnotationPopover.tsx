'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RootThread, type DiscussionUser } from './RootThread';
import { AnnotationQuote } from './AnnotationQuote';
import { contentAPI as api } from './content-client';
import type { AnnotationMarker } from '../modules/annotations';

export function AnnotationPopover({
  notes, x, y, contentId, loginHref, readingHref, onClose,
}: {
  notes: AnnotationMarker[]; x: number; y: number; contentId: string;
  loginHref: string; readingHref: string; onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [user, setUser] = useState<DiscussionUser>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const safeClose = () => {
    const fields = panel.current?.querySelectorAll('textarea');
    if (fields && Array.from(fields).some(field => field.value.trim()) && !confirm('有尚未提交的回复，确定关闭吗？')) return;
    onClose();
  };
  useEffect(() => {
    let mounted = true;
    api('session').then(result => { if (mounted) setUser(result.user || null); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) safeClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); safeClose(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); previousFocus.current?.focus({ preventScroll: true }); };
  }, [onClose]);
  const active = notes[Math.min(index, notes.length - 1)];
  const width = Math.min(440, Math.max(290, (typeof window === 'undefined' ? 440 : window.innerWidth) - 24));
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const left = Math.max(12, Math.min(x - width / 2, vw - width - 12));
  const height = Math.min(550, Math.max(280, vh - 36));
  const top = y + height + 12 > vh ? Math.max(12, y - height - 10) : Math.max(12, y + 10);
  if (!active || typeof document === 'undefined') return null;
  return createPortal(
    <section ref={panel} className="annotation-popover" role="dialog" aria-modal="false" aria-label="原文批注讨论"
      style={{ left, top, width, maxHeight: height }}>
      <header className="annotation-popover-header">
        <strong>这段文字的讨论</strong>
        <button ref={close} type="button" onClick={safeClose} aria-label="关闭批注讨论">×</button>
      </header>
      <div className="annotation-popover-body">
        <AnnotationQuote quote={active.quote} />
        {notes.length > 1 && <div className="annotation-popover-tabs" role="group" aria-label="选择批注">
          {notes.map((note, i) => <button key={note.id} type="button" aria-pressed={i === index} onClick={() => setIndex(i)}>
            批注 {i + 1}
          </button>)}
        </div>}
        <RootThread key={active.comment} rootId={active.comment} contentId={contentId} user={user}
          loginHref={loginHref} readingHref={readingHref} compact initialExpanded />
      </div>
    </section>,
    document.body,
  );
}

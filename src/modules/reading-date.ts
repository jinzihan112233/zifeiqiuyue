export function readingDate(metadata: { originalVideoDate?: string }, publishedAt: string) {
  const date = metadata.originalVideoDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(publishedAt));
  return { date, label: metadata.originalVideoDate ? '原视频' : '本站发布' };
}

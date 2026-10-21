import { readingDate } from '@/modules/reading-date';
export function ArticleDate({ metadata, publishedAt }: { metadata: { originalVideoDate?: string; demo?: boolean }; publishedAt: string }) {
  const value = readingDate(metadata, publishedAt);
  return <time dateTime={value.date}>{value.date.replaceAll('-', '.')} · {value.label}{metadata.demo !== false && ' · 演示'}</time>;
}

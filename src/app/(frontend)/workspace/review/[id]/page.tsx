import { notFound } from 'next/navigation';
import { ContentDesk } from '@/components/ContentDesk';
import '../../../workspace.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: '审核冻结稿', robots: { index: false, follow: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submission?: string | string[] }> }) { const { id } = await params, { submission } = await searchParams; if (!/^[1-9]\d{0,9}$/.test(id) || typeof submission !== 'string' || !/^[1-9]\d{0,9}$/.test(submission)) notFound(); return <div className="workspace"><ContentDesk id={id} review submissionId={submission} /></div>; }

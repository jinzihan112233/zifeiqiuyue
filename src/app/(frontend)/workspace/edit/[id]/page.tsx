import { notFound } from 'next/navigation';
import { ContentDesk } from '@/components/ContentDesk';
import '../../../workspace.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: '编辑工作稿', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; if (!/^[1-9]\d{0,9}$/.test(id)) notFound(); return <div className="workspace"><ContentDesk id={id} /></div>; }

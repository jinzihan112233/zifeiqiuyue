import '../../../workspace.css';
import { Reader } from '@/components/Reader';
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <div className="workspace"><Reader key={id} contentId={id} /></div>; }

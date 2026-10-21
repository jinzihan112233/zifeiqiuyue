import '../workspace.css';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <div className="workspace account-shell">{children}</div>;
}

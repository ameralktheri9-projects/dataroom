export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-stone-500">DATA ROOM</p>
        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

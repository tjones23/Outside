import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <p className="text-sm uppercase tracking-widest text-muted-dim">404</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Nothing here</h1>
      <p className="mt-3 text-muted">That page doesn&apos;t exist.</p>
      <Link href="/" className="mt-8 rounded-full bg-text px-4 py-2 text-sm font-medium text-ink">
        Back to the map
      </Link>
    </div>
  );
}

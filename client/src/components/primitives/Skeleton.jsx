/**
 * Skeleton — the shape of content before the content arrives.
 *
 * A spinner says "wait". A skeleton says "here is what is coming, and where".
 * On a 3G connection in a lift that difference is the whole feel of the app.
 *
 *   <Skeleton className="h-9 w-2/3" />
 *   <SkeletonText lines={3} />
 *   <SkeletonCard />          // a card-shaped placeholder with a title + 3 lines
 */
export function Skeleton({ className = '', rounded = 'rounded-xl', style, ...rest }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-white/[0.06] ${rounded} ${className}`}
      style={style} {...rest} />
  );
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" rounded="rounded-full" style={{ width: `${88 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3, className = '' }) {
  return (
    <div className={`rounded-2xl bg-surface border border-hair p-4 ${className}`} aria-hidden="true">
      <Skeleton className="h-3 w-1/3 mb-4" rounded="rounded-full" />
      <SkeletonText lines={lines} />
    </div>
  );
}

export default Skeleton;

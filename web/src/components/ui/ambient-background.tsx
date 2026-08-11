/**
 * Sitewide backdrop mounted once at the App shell — a few large, slow-drifting
 * blurred blobs in the brand blue, fixed behind every route (Home, wizards,
 * admin, login, etc.), so the rest of the app isn't a flat single-tone page.
 */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-base">
      <div className="absolute -top-32 -left-32 size-[36rem] rounded-full bg-brand-600/10 blur-3xl animate-float-slow" />
      <div
        className="absolute top-1/3 -right-40 size-[30rem] rounded-full bg-brand-400/10 blur-3xl animate-float-slow"
        style={{ animationDelay: '-2.5s' }}
      />
      <div
        className="absolute bottom-0 left-1/4 size-[32rem] rounded-full bg-brand-500/8 blur-3xl animate-float-slow"
        style={{ animationDelay: '-5s' }}
      />
    </div>
  )
}

export default AmbientBackground

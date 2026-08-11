import { useEffect, useRef } from 'react'

/**
 * Looping background video for the Hero (a real house + AVM/report overlay
 * graphics) with a dark tint on top so the headline stays legible against
 * the site's near-black theme.
 *
 * iOS Safari (especially in Low Power Mode) can silently block `autoplay`
 * even with muted+playsInline. The `poster` frame covers that gap visually,
 * and a one-time listener retries `play()` on the user's first tap/scroll —
 * a real user gesture is allowed to start playback even when autoplay isn't.
 */
export function HeroVideoBackground({ className }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Autoplay was blocked — fall back to starting playback on the first
    // real user gesture anywhere on the page (allowed even when autoplay isn't).
    const tryPlay = () => {
      video.play().catch(() => {})
    }
    const events: (keyof DocumentEventMap)[] = ['touchstart', 'click', 'scroll', 'keydown']

    video.play().catch(() => {
      events.forEach((e) => document.addEventListener(e, tryPlay, { once: true, passive: true }))
    })

    return () => events.forEach((e) => document.removeEventListener(e, tryPlay))
  }, [])

  return (
    <div className={`absolute inset-0 overflow-hidden ${className ?? ''}`}>
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        src="/hero-video.mp4"
        poster="/hero-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
      />
      <div className="absolute inset-0 bg-gradient-to-b from-base/90 via-base/70 to-base/95" />
      <div className="absolute inset-0 bg-brand-900/30" />
    </div>
  )
}

export default HeroVideoBackground

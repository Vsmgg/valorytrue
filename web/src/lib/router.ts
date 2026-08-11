import { useEffect, useState } from 'react'

const NAVIGATE_EVENT = 'app:navigate'

export function navigate(path: string) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new Event(NAVIGATE_EVENT))
  }
}

export function useRoute(): string {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const update = () => setPath(window.location.pathname)
    window.addEventListener('popstate', update)
    window.addEventListener(NAVIGATE_EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener(NAVIGATE_EVENT, update)
    }
  }, [])

  return path
}

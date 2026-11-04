import { useCallback, useEffect, useRef, useState } from 'react'
import { pathForView, viewForPath, type View } from './modules'

export const githubSignInPath = (view: View) =>
  view === 'apps'
    ? '/auth/github'
    : `/auth/github?returnTo=${encodeURIComponent(pathForView(view))}`

export function useWorkspaceRoute(clearTransient: () => void) {
  const [view, setView] = useState(() => viewForPath(window.location.pathname))
  const [routeKey, setRouteKey] = useState(0)
  const routeVersion = useRef(0)
  const restore = useCallback(() => {
    routeVersion.current++
    clearTransient()
    setView(viewForPath(window.location.pathname))
    // Registered modules own local dialogs too; remount them on history traversal.
    setRouteKey(routeVersion.current)
  }, [clearTransient])

  useEffect(() => {
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [restore])

  const navigate = useCallback(
    (next: View) => {
      const path = pathForView(next)
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== path)
        window.history.pushState(null, '', path)
      restore()
    },
    [restore],
  )

  return { view, navigate, routeKey, routeVersion }
}

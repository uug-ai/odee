import { useEffect, useLayoutEffect, useState } from 'react'
import { HalfMoon, SunLight } from 'iconoir-react'

type Theme = 'light' | 'dark'
const storageKey = 'odee.theme'
const mediaQuery = '(prefers-color-scheme: dark)'

function parsePreference(value: string | null): Theme | null {
  if (value === 'light' || value === 'dark') return value
  if (value !== null) console.warn('Invalid saved appearance preference; using the system theme.')
  return null
}

function savedPreference(): Theme | null {
  try {
    return parsePreference(localStorage.getItem(storageKey))
  } catch (error) {
    console.warn('Could not read the saved appearance preference; using the system theme.', error)
    return null
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(document.documentElement).backgroundColor)
}

export function initializeTheme() {
  applyTheme(savedPreference() ?? (window.matchMedia(mediaQuery).matches ? 'dark' : 'light'))
}

export function ThemeToggle({ onError }: { onError: (message: string) => void }) {
  const [preference, setPreference] = useState<Theme | null>(savedPreference)
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    window.matchMedia(mediaQuery).matches ? 'dark' : 'light',
  )
  const theme = preference ?? systemTheme
  const next = theme === 'dark' ? 'light' : 'dark'

  useLayoutEffect(() => applyTheme(theme), [theme])

  useEffect(() => {
    const media = window.matchMedia(mediaQuery)
    const systemChanged = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? 'dark' : 'light')
    const preferenceChanged = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        setPreference(parsePreference(event.newValue))
      }
    }
    setSystemTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', systemChanged)
    window.addEventListener('storage', preferenceChanged)
    return () => {
      media.removeEventListener('change', systemChanged)
      window.removeEventListener('storage', preferenceChanged)
    }
  }, [])

  function toggle() {
    setPreference(next)
    try {
      localStorage.setItem(storageKey, next)
    } catch (error) {
      console.warn('Could not save the appearance preference.', error)
      onError('Theme changed for this tab, but your preference could not be saved.')
    }
  }

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <SunLight aria-hidden="true" /> : <HalfMoon aria-hidden="true" />}
    </button>
  )
}

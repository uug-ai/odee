import { useEffect, useRef } from 'react'
import { catalogs, detectLocale, useLocale } from './i18n'

export const routeMessages = (locale: string) => {
  const language = detectLocale(null, [locale])
  const catalog = catalogs[language]
  return {
    language,
    title: catalog['Page not found'],
    description: catalog['This page does not exist or the app is not available yet.'],
    launcher: catalog['Back to workspace'],
  }
}

export function RouteNotFound({ onLauncher }: { onLauncher: () => void }) {
  const title = useRef<HTMLHeadingElement>(null)
  const messages = routeMessages(useLocale())
  useEffect(() => title.current?.focus(), [])
  return (
    <section className="empty" lang={messages.language} aria-labelledby="route-not-found">
      <h1 id="route-not-found" ref={title} tabIndex={-1}>
        {messages.title}
      </h1>
      <p>{messages.description}</p>
      <a
        href="/"
        className="button secondary"
        onClick={(event) => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return
          event.preventDefault()
          onLauncher()
        }}
      >
        {messages.launcher}
      </a>
    </section>
  )
}

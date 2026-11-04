import { useEffect, useRef } from 'react'

export const routeMessages = (locale: string) =>
  locale.toLowerCase().startsWith('nl')
    ? {
        language: 'nl',
        title: 'Pagina niet gevonden',
        description: 'Deze pagina bestaat niet of de app is nog niet beschikbaar.',
        launcher: 'Terug naar de werkruimte',
      }
    : {
        language: 'en',
        title: 'Page not found',
        description: 'This page does not exist or the app is not available yet.',
        launcher: 'Back to workspace',
      }

export function RouteNotFound({ onLauncher }: { onLauncher: () => void }) {
  const title = useRef<HTMLHeadingElement>(null)
  const messages = routeMessages(navigator.language)
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

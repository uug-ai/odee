import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Xmark } from 'iconoir-react'
import { t } from './i18n'
import { LocaleSwitch } from './LocaleSwitch'

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.showModal()
    ref.current
      ?.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="file"]), textarea')
      ?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={wide ? 'review-dialog' : undefined}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <LocaleSwitch />
        <button
          type="button"
          className="icon-button"
          aria-label={t('Close dialog')}
          onClick={onClose}
        >
          <Xmark />
        </button>
      </div>
      {children}
    </dialog>
  )
}

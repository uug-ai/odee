import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Book, Download, Plus, RefreshDouble, ShieldCheck } from 'iconoir-react'
import { money } from './accounting'
import type { APIRequest, BillImport } from './types'
import { messageText, requestMessage, statusText, t } from './i18n'
import { responseStatus } from './api'

const message = (error: unknown) => requestMessage(error, responseStatus(error))
const maxBytes = 20 * 1024 * 1024
const sourceMoney = (cents: number, currency: string) =>
  currency === 'EUR'
    ? money(cents)
    : `${money(cents).replace('€', '').trim()} ${currency || t('(currency not detected)')}`
interface Upload {
  key: string
  name: string
  status: string
  error: string
}

export function BillImports({
  items,
  scannerReady,
  scannerError,
  request,
  onImport,
  onReview,
  onOpen,
  canWrite = false,
}: {
  items: BillImport[]
  scannerReady: boolean
  scannerError: string
  request: APIRequest
  onImport: (item: BillImport) => void
  onReview: (item: BillImport) => void
  onOpen: (id: string) => void
  canWrite?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const running = useRef(false)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rescanning, setRescanning] = useState('')
  const update = (key: string, status: string, error = '') =>
    setUploads((current) =>
      current.map((item) => (item.key === key ? { ...item, status, error } : item)),
    )

  async function upload(files: File[]) {
    if (!canWrite) {
      setError('Write capability required.')
      return
    }
    setDragging(false)
    setError('')
    if (running.current) {
      setError('A batch is already processing. Wait for it to finish before adding more files.')
      return
    }
    if (!files.length) {
      setError('Drop files rather than folders, or use Choose bills.')
      return
    }
    if (files.length > 20) {
      setError('Choose at most 20 bills per batch.')
      return
    }
    running.current = true
    setBusy(true)
    const batch = files.map((file) => ({ file, key: crypto.randomUUID() }))
    setUploads(
      batch.map((item) => ({ key: item.key, name: item.file.name, status: 'Queued', error: '' })),
    )
    try {
      for (const { file, key } of batch) {
        if (file.size === 0 || file.size > maxBytes || !/\.(pdf|png|jpe?g)$/i.test(file.name)) {
          update(key, 'Rejected', 'Choose a nonempty PDF, PNG or JPEG of at most 20 MiB.')
          continue
        }
        update(key, 'Uploading and scanning')
        const form = new FormData()
        form.append('file', file)
        try {
          const response = await request<{ import: BillImport; duplicate: boolean }>(
            'imports',
            form,
          )
          onImport(response.import)
          update(
            key,
            response.duplicate
              ? 'Duplicate - original already stored'
              : response.import.status === 'failed'
                ? 'Stored - scan needs attention'
                : 'Ready for review',
            response.import.error,
          )
        } catch (error) {
          update(key, 'Not confirmed', message(error))
        }
      }
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const uploadRef = useRef(upload)
  uploadRef.current = upload
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      void uploadRef.current(Array.from(event.dataTransfer.files))
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  async function rescan(item: BillImport) {
    setRescanning(item.id)
    setError('')
    try {
      onImport(await request<BillImport>(`imports/${item.id}/scan`, {}))
    } catch (error) {
      setError(message(error))
    } finally {
      setRescanning('')
    }
  }

  return (
    <section className="bill-imports">
      <div
        className={`bill-dropzone ${dragging ? 'dragging' : ''}`}
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        role="region"
        aria-label={t('Drop bill documents')}
      >
        <span className="empty-icon">
          <Book />
        </span>
        <div>
          <h2>{t('Drop your bills. Keep the originals.')}</h2>
          <p>{t('PDF, PNG or JPEG · up to 20 MiB each · up to 20 files per batch')}</p>
          <small>
            {t('Local scan → review → draft. Nothing is posted or paid automatically.')}
          </small>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={busy || !canWrite}
          onClick={() => input.current?.click()}
        >
          <Plus />
          {t('Choose bills')}
        </button>
        <input
          ref={input}
          className="sr-only"
          type="file"
          aria-label={t('Upload bills')}
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          multiple
          disabled={busy || !canWrite}
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </div>
      {!scannerReady && (
        <p className="form-error" role="status">
          {scannerError ? messageText(scannerError) : t('Local scanning is unavailable.')}{' '}
          {t('Originals can still be stored and reviewed manually.')}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {messageText(error)}
        </p>
      )}
      {uploads.length > 0 && (
        <div className="upload-progress" aria-live="polite">
          {uploads.map((item) => (
            <div key={item.key}>
              <strong>{item.name}</strong>
              <span>{messageText(item.status)}</span>
              {item.error && <small className="late-text">{messageText(item.error)}</small>}
              {item.status === 'Not confirmed' && (
                <small>
                  {t(
                    'Refresh the workspace before retrying; the original may already have been stored.',
                  )}
                </small>
              )}
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="panel import-inbox">
          <div className="section-heading">
            <div>
              <h2>{t('Document inbox')}</h2>
              <p>{t('Originals stay here, including failed scans and linked drafts.')}</p>
            </div>
            <span className="badge">{t('{count} originals', { count: items.length })}</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Original')}</th>
                  <th>{t('Scan result')}</th>
                  <th>{t('Total detected')}</th>
                  <th>{t('Action')}</th>
                </tr>
              </thead>
              <tbody>
                {[...items]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.filename}</strong>
                        <small>
                          {(item.size / 1024).toFixed(0)} KiB ·{' '}
                          {item.scan.method || t('Not scanned')}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`badge ${item.status === 'failed' ? 'overdue' : item.documentId ? 'paid' : 'posted'}`}
                        >
                          {item.documentId
                            ? t('Bill linked')
                            : item.status === 'failed'
                              ? t('Needs attention')
                              : statusText(item.status)}
                        </span>
                        {item.error && (
                          <small className="late-text">{messageText(item.error)}</small>
                        )}
                      </td>
                      <td>
                        {item.scan.total > 0
                          ? `${sourceMoney(item.scan.total, item.scan.currency)} ${item.scan.currency && item.scan.currency !== 'EUR' ? t('(unsupported)') : ''}`
                          : t('Not detected')}
                      </td>
                      <td>
                        <div className="heading-actions">
                          {item.documentId ? (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => onOpen(item.documentId!)}
                            >
                              {t('Open bill')} <ArrowRight />
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="text-button"
                                disabled={
                                  !canWrite ||
                                  item.status === 'pending' ||
                                  item.status === 'scanning'
                                }
                                onClick={() => onReview(item)}
                              >
                                {t('Review original')} <ArrowRight />
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                disabled={!canWrite || rescanning !== '' || busy}
                                aria-label={t('Retry scan {filename}', { filename: item.filename })}
                                onClick={() => void rescan(item)}
                              >
                                <RefreshDouble className={rescanning === item.id ? 'spin' : ''} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

async function fileResponse(
  id: string,
  suffix: string,
  token: string,
  onSessionExpired: () => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/imports/${id}/${suffix}`, {
    credentials: 'same-origin',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  })
  if (response.status === 401) onSessionExpired()
  if (response.status === 401 || response.status === 403)
    throw new Error(requestMessage(undefined, response.status))
  if (!response.ok) {
    const data: unknown = await response.json()
    throw new Error(
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Original document request failed (${response.status}).`,
    )
  }
  return response.blob()
}

export function OriginalPreview({
  item,
  token,
  onSessionExpired,
}: {
  item: BillImport
  token: string
  onSessionExpired: () => void
}) {
  const [page, setPage] = useState(1)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    setLoading(true)
    setError('')
    setUrl('')
    void fileResponse(item.id, `preview?page=${page}`, token, onSessionExpired, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.id, token, page, onSessionExpired])
  async function download() {
    setError('')
    try {
      const blob = await fileResponse(item.id, 'original', token, onSessionExpired)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = item.filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setError(message(error))
    }
  }
  return (
    <aside className="original-preview">
      <div className="original-heading">
        <div>
          <strong>{item.filename}</strong>
          <small>
            {t('Unmodified original')} · {item.scan.method || t('Manual review')}
          </small>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Download original')}
          onClick={() => void download()}
        >
          <Download />
        </button>
      </div>
      {item.contentType === 'application/pdf' && item.scan.pages > 1 && (
        <label className="preview-pages">
          {t('PDF page')}
          <select value={page} onChange={(event) => setPage(Number(event.target.value))}>
            {Array.from({ length: item.scan.pages }, (_, index) => (
              <option key={index} value={index + 1}>
                {t('{page} of {total}', { page: index + 1, total: item.scan.pages })}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading && <p className="preview-status">{t('Preparing original preview…')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {messageText(error)} {t('You can still download the original.')}
        </p>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={t('Original bill {filename}, page {page}', { filename: item.filename, page })}
            onError={() => setError('The original image could not be displayed.')}
          />
        </a>
      )}
      <div className="scanned-totals">
        <span>
          {t('Detected subtotal')}
          <strong>
            {item.scan.subtotal > 0
              ? sourceMoney(item.scan.subtotal, item.scan.currency)
              : t('Not detected')}
          </strong>
        </span>
        <span>
          {t('Detected VAT')}
          <strong>
            {item.scan.taxKnown
              ? sourceMoney(item.scan.tax, item.scan.currency)
              : t('Not detected')}
          </strong>
        </span>
        <span>
          {t('Detected total')}
          <strong>
            {item.scan.total > 0
              ? sourceMoney(item.scan.total, item.scan.currency)
              : t('Not detected')}
          </strong>
        </span>
      </div>
      <p className="source-currency">
        <ShieldCheck />
        {t('Source currency')}: {item.scan.currency || t('Not detected; confirm EUR')}
      </p>
      {item.error && <p className="form-error">{messageText(item.error)}</p>}
      <details className="extracted-text">
        <summary>{t('Extracted text')}</summary>
        <pre>
          {item.scan.text ||
            t('No text could be extracted. Complete the fields from the original.')}
        </pre>
      </details>
    </aside>
  )
}

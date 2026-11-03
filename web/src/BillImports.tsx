import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Book, Download, Plus, RefreshDouble, ShieldCheck } from 'iconoir-react'
import { money } from './accounting'
import type { APIRequest, BillImport } from './types'

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The document operation failed.'
const maxBytes = 20 * 1024 * 1024
const sourceMoney = (cents: number, currency: string) =>
  currency === 'EUR'
    ? money(cents)
    : `${(cents / 100).toLocaleString('en-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || '(currency not detected)'}`
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
}: {
  items: BillImport[]
  scannerReady: boolean
  scannerError: string
  request: APIRequest
  onImport: (item: BillImport) => void
  onReview: (item: BillImport) => void
  onOpen: (id: string) => void
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
          update(
            key,
            'Not confirmed',
            `${message(error)} Refresh the workspace before retrying; the original may already have been stored.`,
          )
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
        aria-label="Drop bill documents"
      >
        <span className="empty-icon">
          <Book />
        </span>
        <div>
          <h2>Drop your bills. Keep the originals.</h2>
          <p>PDF, PNG or JPEG · up to 20 MiB each · up to 20 files per batch</p>
          <small>Local scan → review → draft. Nothing is posted or paid automatically.</small>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Plus />
          Choose bills
        </button>
        <input
          ref={input}
          className="sr-only"
          type="file"
          aria-label="Upload bills"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          multiple
          disabled={busy}
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </div>
      {!scannerReady && (
        <p className="form-error" role="status">
          {scannerError || 'Local scanning is unavailable.'} Originals can still be stored and
          reviewed manually.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {uploads.length > 0 && (
        <div className="upload-progress" aria-live="polite">
          {uploads.map((item) => (
            <div key={item.key}>
              <strong>{item.name}</strong>
              <span>{item.status}</span>
              {item.error && <small className="late-text">{item.error}</small>}
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="panel import-inbox">
          <div className="section-heading">
            <div>
              <h2>Document inbox</h2>
              <p>Originals stay here, including failed scans and linked drafts.</p>
            </div>
            <span className="badge">{items.length} originals</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Original</th>
                  <th>Scan result</th>
                  <th>Total detected</th>
                  <th>Action</th>
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
                          {(item.size / 1024).toFixed(0)} KiB · {item.scan.method || 'Not scanned'}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`badge ${item.status === 'failed' ? 'overdue' : item.documentId ? 'paid' : 'posted'}`}
                        >
                          {item.documentId
                            ? 'Bill linked'
                            : item.status === 'failed'
                              ? 'Needs attention'
                              : item.status}
                        </span>
                        {item.error && <small className="late-text">{item.error}</small>}
                      </td>
                      <td>
                        {item.scan.total > 0
                          ? `${sourceMoney(item.scan.total, item.scan.currency)} ${item.scan.currency && item.scan.currency !== 'EUR' ? '(unsupported)' : ''}`
                          : 'Not detected'}
                      </td>
                      <td>
                        <div className="heading-actions">
                          {item.documentId ? (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => onOpen(item.documentId!)}
                            >
                              Open bill <ArrowRight />
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="text-button"
                                disabled={item.status === 'pending' || item.status === 'scanning'}
                                onClick={() => onReview(item)}
                              >
                                Review original <ArrowRight />
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                disabled={rescanning !== '' || busy}
                                aria-label={`Retry scan ${item.filename}`}
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
          <small>Unmodified original · {item.scan.method || 'Manual review'}</small>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Download original"
          onClick={() => void download()}
        >
          <Download />
        </button>
      </div>
      {item.contentType === 'application/pdf' && item.scan.pages > 1 && (
        <label className="preview-pages">
          PDF page
          <select value={page} onChange={(event) => setPage(Number(event.target.value))}>
            {Array.from({ length: item.scan.pages }, (_, index) => (
              <option key={index} value={index + 1}>
                {index + 1} of {item.scan.pages}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading && <p className="preview-status">Preparing original preview…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error} You can still download the original.
        </p>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={`Original bill ${item.filename}, page ${page}`}
            onError={() => setError('The original image could not be displayed.')}
          />
        </a>
      )}
      <div className="scanned-totals">
        <span>
          Detected subtotal
          <strong>
            {item.scan.subtotal > 0
              ? sourceMoney(item.scan.subtotal, item.scan.currency)
              : 'Not detected'}
          </strong>
        </span>
        <span>
          Detected VAT
          <strong>
            {item.scan.taxKnown ? sourceMoney(item.scan.tax, item.scan.currency) : 'Not detected'}
          </strong>
        </span>
        <span>
          Detected total
          <strong>
            {item.scan.total > 0
              ? sourceMoney(item.scan.total, item.scan.currency)
              : 'Not detected'}
          </strong>
        </span>
      </div>
      <p className="source-currency">
        <ShieldCheck />
        Source currency: {item.scan.currency || 'Not detected; confirm EUR'}
      </p>
      {item.error && <p className="form-error">{item.error}</p>}
      <details className="extracted-text">
        <summary>Extracted text</summary>
        <pre>
          {item.scan.text || 'No text could be extracted. Complete the fields from the original.'}
        </pre>
      </details>
    </aside>
  )
}

import { useEffect, useRef } from 'react'
import { CloseIcon } from './icons.jsx'

// Modal dialog built on the native <dialog> element: focus is trapped, Escape
// closes it, and the page behind is inert. No animation.
export default function Dialog({ open, onClose, title, description, children, footer, size = 'md' }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const width = size === 'lg' ? 'max-w-3xl' : 'max-w-lg'

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={`m-auto w-[calc(100%-2rem)] overflow-hidden ${width} rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40`}
      aria-labelledby="dialog-title"
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 id="dialog-title" className="text-base font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-600"
              aria-label="Close"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}

import { useState, useRef } from 'react'

const BASE_URL =
  'https://rxiarmbosgivaplygqug.supabase.co/storage/v1/object/public/lista-precios/2026/'

const TOTAL_PAGES = 20

const PAGES = Array.from({ length: TOTAL_PAGES }, (_, i) => ({
  num: i + 1,
  url: `${BASE_URL}${i + 1}.png`,
}))

export default function ListaPrecios() {
  const [current, setCurrent] = useState(0)       // índice 0-based
  const [thumbsOpen, setThumbsOpen] = useState(false)

  // Touch swipe
  const touchStartX = useRef(null)

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e) {
    if (touchStartX.current === null) return
    const delta = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(delta) > 40) {
      if (delta > 0) goNext()
      else goPrev()
    }
    touchStartX.current = null
  }

  function goPrev() {
    setCurrent((c) => Math.max(0, c - 1))
  }

  function goNext() {
    setCurrent((c) => Math.min(TOTAL_PAGES - 1, c + 1))
  }

  function goTo(idx) {
    setCurrent(idx)
    setThumbsOpen(false)
  }

  const page = PAGES[current]

  return (
    <div className="min-h-screen bg-[#111] flex flex-col select-none">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#111] border-b border-white/10">
        <div>
          <p className="text-[10px] text-white/40 font-medium uppercase tracking-widest">FlowSuiteCRM</p>
          <p className="text-sm font-bold text-white font-display leading-tight">Lista de Precios 2026</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50">
            {current + 1} / {TOTAL_PAGES}
          </span>
          <button
            onClick={() => setThumbsOpen((o) => !o)}
            className="text-xs font-semibold text-white/70 border border-white/20 rounded-md px-2 py-1 hover:bg-white/10 transition-colors"
          >
            Páginas
          </button>
        </div>
      </header>

      {/* ── Visor principal ── */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <img
          key={page.url}
          src={page.url}
          alt={`Lista de precios página ${page.num}`}
          className="max-h-[calc(100dvh-112px)] w-full object-contain"
          draggable={false}
        />

        {/* Botones prev / next — visibles en desktop, en móvil el swipe */}
        <button
          onClick={goPrev}
          disabled={current === 0}
          className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hidden md:flex items-center justify-center text-lg disabled:opacity-20 hover:bg-black/70 transition-colors"
          aria-label="Página anterior"
        >
          ‹
        </button>
        <button
          onClick={goNext}
          disabled={current === TOTAL_PAGES - 1}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hidden md:flex items-center justify-center text-lg disabled:opacity-20 hover:bg-black/70 transition-colors"
          aria-label="Página siguiente"
        >
          ›
        </button>
      </div>

      {/* ── Controles inferiores ── */}
      <nav className="flex items-center justify-between px-6 py-3 bg-[#111] border-t border-white/10">
        <button
          onClick={goPrev}
          disabled={current === 0}
          className="text-sm font-semibold text-white/70 disabled:opacity-25 hover:text-white transition-colors"
        >
          ← Anterior
        </button>
        {/* Barra de progreso */}
        <div className="flex-1 mx-4 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${((current + 1) / TOTAL_PAGES) * 100}%` }}
          />
        </div>
        <button
          onClick={goNext}
          disabled={current === TOTAL_PAGES - 1}
          className="text-sm font-semibold text-white/70 disabled:opacity-25 hover:text-white transition-colors"
        >
          Siguiente →
        </button>
      </nav>

      {/* ── Panel de miniaturas ── */}
      {thumbsOpen && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <p className="text-sm font-semibold text-white">Seleccionar página</p>
            <button
              onClick={() => setThumbsOpen(false)}
              className="text-white/60 hover:text-white text-lg"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-3">
            {PAGES.map((p, idx) => (
              <button
                key={p.num}
                onClick={() => goTo(idx)}
                className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                  idx === current ? 'border-accent' : 'border-transparent'
                }`}
              >
                <img
                  src={p.url}
                  alt={`Página ${p.num}`}
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                />
                <span className="absolute bottom-1 right-1 text-[10px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">
                  {p.num}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

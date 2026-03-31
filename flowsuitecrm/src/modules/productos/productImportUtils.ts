/**
 * Utilidades de importación de lista de precios (Hycite).
 * Parsea el formato de reporte "Cuentas por Cobrar" exportado en XLSX.
 */

export type PriceEntry = {
  categoria_compra: 'mercaderia' | 'premium' | 'miscelaneos'
  codigo: string
  descripcion: string
  precio_base: number
  recargo_arancelario: number
}

export const normalizeText = (value: unknown) => String(value ?? '').trim()

export const parseMoney = (value: unknown): number | null => {
  const cleaned = normalizeText(value).replace(/\$/g, '').replace(/,/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export const parseCategoriaCompra = (value: unknown): PriceEntry['categoria_compra'] | null => {
  const code = normalizeText(value).toUpperCase()
  if (code === 'MRCH') return 'mercaderia'
  if (code === 'PREM') return 'premium'
  if (code === 'MISC') return 'miscelaneos'
  return null
}

export const inferLinea = (descripcion: string): string => {
  const upper = descripcion.toUpperCase()
  if (upper.includes('NOVEL')) return 'Novel'
  if (upper.includes('INNOVE')) return 'Innove'
  if (upper.includes('5 CAPAS') || upper.includes('5 CPS') || upper.includes('5CPS') || upper.includes('5CPAS')) return '5 Capas'
  if (upper.includes('EASY RELEASE')) return 'Easy Release'
  if (upper.includes('GOURMET') || upper.includes('GOURMT')) return 'Gourmet'
  if (upper.includes('PRECISION')) return 'Precision'
  return 'General'
}

export const inferCategoriaPrincipal = (descripcion: string, categoriaCompra: PriceEntry['categoria_compra']): string => {
  const upper = descripcion.toUpperCase()
  const has = (term: string) => upper.includes(term)

  if (has('FILTRO') || has('FRESCAPURE') || has('FRESCAFLOW') || has('OSMOSIS') || has('MINERAL') || has('ULTRAVIOLETA') || has('PURIFIC')) {
    return 'Filtracion'
  }
  if (has('CUCHILLO') || has('CUCHILL') || has('SANTOKU') || has('AFILADOR') || has('HACHA') || has('BLOQUE')) {
    return 'Cuchillos'
  }
  if (
    categoriaCompra === 'miscelaneos' &&
    (has('VALVULA') || has('VÁLVULA') || has('MANGO') || has('AGARR') || has('ASA') || has('ARO') || has('EMPAQUE') || has('PIEZA') || has('CUBIERTA'))
  ) {
    return 'Repuestos'
  }
  if (has('TAPA') || has('PARRILLA') || has('COLADOR') || has('ARO') || has('COVER')) {
    return 'Tapas y Parrillas'
  }
  if (has('BARISTA') || has('EXPERTEA') || has('ESPRESSO') || has('CHOCOLATERA') || has('BLENDER') || has('JUICER') || has('EXTRACTOR') || has('PRECISION COOK')) {
    return 'Electrodomesticos'
  }
  if (has('VASO') || has('COPA') || has('VAJILLA') || has('TAZON') || has('CRISTAL') || has('BAMBÚ') || has('BAMBU')) {
    return 'Vajilla'
  }
  if (has('FOLLETO') || has('CATALOGO') || has('RECETARIO') || has('LITERATURA') || has('BROCHURE') || has('TRIPTICO') || has('REVISTA') || has('LAMINAS')) {
    return 'Literatura'
  }
  if (has('MALETA') || has('MALETIN') || has('BOLSA') || has('MANTEL') || has('PRENDEDOR') || has('POSTER') || has('KIT DE PRESENTACION') || has('TARJETAS')) {
    return 'Materiales'
  }
  if (has('JUEGO') || has('JGO') || has('SIST') || has('SET')) {
    return 'Juegos de Ollas'
  }
  if (has('OLLA') || has('SARTEN') || has('PAELLERA') || has('WOK') || has('MULTIPAN') || has('CACEROLA') || has('PRESION')) {
    return 'Ollas y Sartenes'
  }
  return 'Accesorios'
}

export const inferSubcategoria = (categoriaPrincipal: string, descripcion: string): string => {
  const upper = descripcion.toUpperCase()
  const has = (term: string) => upper.includes(term)

  if (categoriaPrincipal === 'Filtracion') {
    if (has('CARTUCHO') || has('REPUEST') || has('REEMPLAZO')) return 'Repuestos filtros'
    if (has('FRESCAPURE')) return 'FrescaPure'
    if (has('FRESCAFLOW')) return 'FrescaFlow'
    if (has('ULTRA')) return 'Ultra'
    return 'General'
  }
  if (categoriaPrincipal === 'Tapas y Parrillas') {
    if (has('TAPA ALTA')) return 'Tapa alta'
    if (has('TAPA')) return 'Tapa'
    if (has('PARRILLA')) return 'Parrilla'
    if (has('COLADOR')) return 'Colador'
    if (has('ARO')) return 'Aro'
    return 'General'
  }
  if (categoriaPrincipal === 'Ollas y Sartenes') {
    if (has('OLLA')) return 'Olla'
    if (has('SARTEN')) return 'Sarten'
    if (has('PAELLERA')) return 'Paellera'
    if (has('WOK')) return 'Wok'
    if (has('MULTIPAN')) return 'MultiPan'
    if (has('PRESION')) return 'Olla presion'
    return 'General'
  }
  if (categoriaPrincipal === 'Electrodomesticos') {
    if (has('BLENDER')) return 'Blender'
    if (has('JUICER') || has('EXTRACTOR')) return 'Extractor'
    if (has('PRECISION COOK')) return 'Precision Cook'
    if (has('BARISTA') || has('ESPRESSO')) return 'Cafe'
    if (has('EXPERTEA')) return 'Te'
    if (has('CHOCOLATERA')) return 'Chocolate'
    return 'General'
  }
  if (categoriaPrincipal === 'Cuchillos') {
    if (has('SANTOKU')) return 'Santoku'
    if (has('AFILADOR')) return 'Afilador'
    if (has('BLOQUE')) return 'Bloque'
    if (has('HACHA')) return 'Hacha'
    if (has('JUEGO') || has('SET')) return 'Set'
    return 'General'
  }
  if (categoriaPrincipal === 'Vajilla') {
    if (has('VASO')) return 'Vasos'
    if (has('COPA')) return 'Copas'
    if (has('TAZON')) return 'Tazones'
    if (has('TABLA')) return 'Tablas'
    if (has('RECIPIENTE')) return 'Recipientes'
    return 'General'
  }
  if (categoriaPrincipal === 'Accesorios') {
    if (has('PERFECT POP')) return 'Perfect Pop'
    if (has('SMART TEMP')) return 'Smart Temp'
    if (has('WARMER')) return 'Warmer Pro'
    if (has('UTENSIL')) return 'Utensilios'
    return 'General'
  }
  if (categoriaPrincipal === 'Repuestos') {
    if (has('VALVULA') || has('VÁLVULA')) return 'Valvulas'
    if (has('MANGO') || has('AGARR') || has('ASA')) return 'Mangos y agarraderas'
    if (has('ARO')) return 'Aros'
    if (has('EMPAQUE')) return 'Empaques'
    return 'General'
  }
  if (categoriaPrincipal === 'Juegos de Ollas') {
    return 'Juegos'
  }
  return 'General'
}

export const computeCosts = (categoriaCompra: PriceEntry['categoria_compra'], base: number) => {
  if (categoriaCompra !== 'mercaderia') {
    return {
      costo_n1: base,
      costo_n2: base,
      costo_n3: base,
      costo_n4: base,
    }
  }
  return {
    costo_n1: Number((base * 0.9).toFixed(2)),
    costo_n2: Number((base * 0.95).toFixed(2)),
    costo_n3: Number(base.toFixed(2)),
    costo_n4: Number((base * 1.1).toFixed(2)),
  }
}

export const extractEntries = (rows: unknown[][]): PriceEntry[] => {
  const entries: PriceEntry[] = []
  const extractBlock = (row: unknown[], offset: number) => {
    const categoriaCompra = parseCategoriaCompra(row[offset])
    if (!categoriaCompra) return
    const codigo = normalizeText(row[offset + 1])
    const descripcion = normalizeText(row[offset + 3])
    const precio = parseMoney(row[offset + 7])
    const recargo = parseMoney(row[offset + 9]) ?? 0
    if (!codigo || !descripcion || precio == null) return
    entries.push({
      categoria_compra: categoriaCompra,
      codigo,
      descripcion,
      precio_base: precio,
      recargo_arancelario: recargo,
    })
  }

  rows.forEach((row) => {
    extractBlock(row, 0)
    extractBlock(row, 12)
  })

  return entries
}

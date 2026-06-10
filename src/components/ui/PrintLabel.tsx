import { useState } from 'react'
import JsBarcode from 'jsbarcode'
import { Printer, X, Minus, Plus, Truck } from 'lucide-react'
import type { Product } from '@/types'

function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  const sum = code.slice(0, 12).split('').reduce((acc, d, i) =>
    acc + parseInt(d) * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10 === parseInt(code[12])
}

function buildBarcodeSVG(value: string, height: number, barWidth: number): string {
  const useEan13 = isValidEan13(value)
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.style.position = 'absolute'
  svg.style.left = '-9999px'
  document.body.appendChild(svg)
  try {
    JsBarcode(svg, value, {
      format: useEan13 ? 'EAN13' : 'CODE128',
      // EAN13 at width=1 → ~30mm total, fits in 34mm label without scaling → bar ≥ 0.264mm (scannable)
      width: useEan13 ? 1.2 : barWidth,
      height,
      displayValue: true,
      fontSize: 13,
      // EAN13 has built-in quiet zones; extra margin would make it wider
      margin: useEan13 ? 0 : 5,
      background: '#ffffff',
      lineColor: '#000000',
    })
  } finally {
    document.body.removeChild(svg)
  }
  svg.style.cssText = ''
  return new XMLSerializer().serializeToString(svg)
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface LabelSize {
  label: string
  w: number
  h: number
  perRow: number
  pageW: number
  pageH: number
  barcodeH: number
  barcodeBarWidth: number
  nameFontPt: number
  codeFontPt: number
  priceFontPt: number
}

const LABEL_SIZES: LabelSize[] = [
  { label: 'Cuộn 3 nhãn (104 × 22 mm)', w: 34, h: 22, perRow: 3, pageW: 104, pageH: 22, barcodeH: 35, barcodeBarWidth: 1.0, nameFontPt: 6, codeFontPt: 5, priceFontPt: 6 },
]

const COPY_PRESETS = [1, 5, 10, 20, 50]

function buildLayoutCSS(size: LabelSize): string {
  if (size.perRow === 1) {
    return `
    .label {
      width: ${size.pageW}mm;
      height: ${size.pageH}mm;
      padding: 1.5mm 2mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
    }`
  }
  return `
    .row {
      display: flex;
      width: ${size.pageW}mm;
      height: ${size.pageH}mm;
      page-break-after: always;
      break-after: page;
    }
    .label {
      flex: 1;
      height: ${size.pageH}mm;
      padding: 0.5mm 0.8mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      overflow: hidden;
      border-right: 0.3mm dashed #ddd;
    }
    .label:last-child { border-right: none; }`
}

function buildSharedCSS(size: LabelSize): string {
  return `
    @page {
      size: ${size.pageW}mm ${size.pageH}mm;
      margin: 0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
    }
    ${buildLayoutCSS(size)}
    .name {
      font-size: ${size.nameFontPt}pt;
      font-weight: bold;
      text-align: center;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }
    .codes {
      font-size: ${size.codeFontPt}pt;
      color: #333;
      text-align: center;
    }
    .product-code strong { letter-spacing: 0.5px; }
    .barcode-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      width: 100%;
    }
    .barcode-wrap svg { max-width: 100%; height: auto; }
    .price {
      font-size: ${size.priceFontPt}pt;
      font-weight: bold;
      color: #c0392b;
      letter-spacing: 0.3px;
    }`
}

function buildLabelsHTML(product: Product, barcode: string, copies: number, size: LabelSize): string {
  const barcodeSVG = buildBarcodeSVG(barcode, size.barcodeH, size.barcodeBarWidth)
  const singleLabel = `
    <div class="label">
      <div class="name">${escHtml(product.name)}</div>
      <div class="codes">
        <span class="product-code">Mã: <strong>${escHtml(product.product_code)}</strong></span>
      </div>
      <div class="barcode-wrap">${barcodeSVG}</div>
    </div>`

  if (size.perRow === 1) {
    return Array(copies).fill(singleLabel).join('')
  }
  const rows = Math.ceil(copies / size.perRow)
  return Array.from({ length: rows }, (_, r) =>
    `<div class="row">${
      Array.from({ length: size.perRow }, (_, c) =>
        r * size.perRow + c < copies ? singleLabel : '<div class="label"></div>'
      ).join('')
    }</div>`
  ).join('')
}

function buildPrintHTML(
  product: Product,
  barcode: string,
  copies: number,
  size: LabelSize,
): string {
  const labelsHTML = buildLabelsHTML(product, barcode, copies, size)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>In Tem - ${escHtml(product.name)}</title>
  <style>${buildSharedCSS(size)}</style>
</head>
<body>
  ${labelsHTML}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); window.close(); }, 400);
    };
  <\/script>
</body>
</html>`
}

function buildBatchPrintHTML(
  items: Array<{ product: Product; barcode: string; copies: number }>,
  size: LabelSize,
): string {
  const allLabelsHTML = items
    .filter(item => item.copies > 0)
    .map(item => buildLabelsHTML(item.product, item.barcode, item.copies, size))
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>In Tem - ${items.length} sản phẩm</title>
  <style>${buildSharedCSS(size)}</style>
</head>
<body>
  ${allLabelsHTML}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); window.close(); }, 400);
    };
  <\/script>
</body>
</html>`
}

export interface BatchPrintItem {
  product: Product
  quantity: number
  supplierId?: string | null
}

interface Props {
  product: Product | null
  onClose: () => void
}

export function PrintLabelModal({ product, onClose }: Props) {
  const [copies, setCopies] = useState(1)
  const [sizeIdx, setSizeIdx] = useState(0)
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null)

  if (!product) return null

  const hasNccs = (product.product_suppliers?.length ?? 0) > 0
  const activeNcc = hasNccs
    ? (product.product_suppliers!.find((ps) => ps.supplier_id === selectedSupplierId)
       ?? product.product_suppliers![0])
    : null

  const activeBarcodeValue = activeNcc?.barcode ?? product.barcode
  const activeNccName = activeNcc?.supplier?.name ?? null

  function handlePrint() {
    if (!product) return
    const win = window.open('', '_blank', 'width=800,height=600,menubar=no,toolbar=no')
    if (!win) {
      alert('Trình duyệt chặn popup. Vui lòng cho phép popup từ trang này.')
      return
    }
    win.document.write(buildPrintHTML(product, activeBarcodeValue, copies, LABEL_SIZES[sizeIdx]))
    win.document.close()
  }

  const size = LABEL_SIZES[sizeIdx]
  // Use larger scale for the narrow 3-label roll so the preview is visible
  const px = size.perRow > 1 ? 4 : 2.5

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Printer size={20} className="text-blue-600" />
            In Tem Sản Phẩm
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Product info */}
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm">
            <p className="font-semibold text-gray-900">{product.name}</p>
            <div className="flex flex-wrap gap-4 mt-1 text-gray-500">
              <span>Mã hàng: <strong className="text-gray-800">{product.product_code}</strong></span>
              <span>Mã vạch: <strong className="text-gray-800 font-mono">{activeBarcodeValue}</strong></span>
            </div>
          </div>

          {/* NCC Barcode Selector */}
          {hasNccs && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                <Truck size={14} className="text-indigo-500" />
                Chọn mã vạch theo Nhà Cung Cấp
              </label>
              <div className="space-y-2">
                {product.product_suppliers!.map((ps) => {
                  const isActive = activeNcc?.supplier_id === ps.supplier_id
                  return (
                    <button
                      key={ps.supplier_id}
                      type="button"
                      onClick={() => setSelectedSupplierId(ps.supplier_id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                        isActive
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        isActive ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                      }`}>
                        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {ps.supplier?.name ?? 'NCC không xác định'}
                        </p>
                        <p className="text-xs font-mono text-gray-500 mt-0.5">{ps.barcode}</p>
                      </div>
                      <div className="text-right flex-shrink-0 text-xs text-gray-500">
                        <p>Tồn: <span className="font-bold text-green-700">{ps.quantity}</span></p>
                      </div>
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                Tem sẽ in mã vạch của NCC được chọn ở trên.
              </p>
            </div>
          )}

          {/* Size selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Kích thước tem</label>
            <div className="flex gap-2 flex-wrap">
              {LABEL_SIZES.map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => setSizeIdx(i)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    sizeIdx === i
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Label preview */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Xem trước</label>
            <div className="flex justify-center overflow-x-auto">
              {size.perRow === 1 ? (
                <div
                  className="border-2 border-dashed border-gray-300 bg-white rounded shadow-sm flex flex-col items-center justify-between overflow-hidden flex-shrink-0"
                  style={{ width: size.pageW * px, height: size.pageH * px, padding: `${1.5 * px}px ${2 * px}px` }}
                >
                  <p className="font-bold text-center leading-tight overflow-hidden" style={{ fontSize: size.nameFontPt * px * 0.6, maxWidth: '100%' }}>
                    {product.name}
                  </p>
                  <p className="text-gray-500" style={{ fontSize: size.codeFontPt * px * 0.6 }}>
                    Mã: <strong className="text-gray-800">{product.product_code}</strong>
                  </p>
                  <PreviewBarcode barcode={activeBarcodeValue} height={size.barcodeH * px * 0.55} />
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-gray-300 bg-white rounded shadow-sm flex flex-row overflow-hidden flex-shrink-0"
                  style={{ width: size.pageW * px, height: size.pageH * px }}
                >
                  {Array.from({ length: size.perRow }, (_, i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center justify-between overflow-hidden"
                      style={{
                        flex: 1,
                        height: '100%',
                        padding: `${0.5 * px}px ${0.8 * px}px`,
                        borderRight: i < size.perRow - 1 ? '1px dashed #d1d5db' : 'none',
                      }}
                    >
                      <p className="font-bold text-center leading-tight overflow-hidden truncate w-full" style={{ fontSize: size.nameFontPt * px * 0.6 }}>
                        {product.name}
                      </p>
                      <p className="text-gray-500" style={{ fontSize: size.codeFontPt * px * 0.6 }}>
                        {product.product_code}
                      </p>
                      <PreviewBarcode barcode={activeBarcodeValue} height={size.barcodeH * px * 0.55} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            {activeNccName && (
              <p className="text-center text-xs text-indigo-600 mt-1.5 font-medium flex items-center justify-center gap-1">
                <Truck size={11} /> Mã vạch của {activeNccName}
              </p>
            )}
            <p className="text-center text-xs text-gray-400 mt-0.5">Tỷ lệ xem trước (không chính xác 100%)</p>
          </div>

          {/* Copy count */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Số lượng tem</label>
            <div className="flex items-center gap-3">
              <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => setCopies((c) => Math.max(1, c - 1))}
                  className="px-3 py-2 hover:bg-gray-50 transition-colors text-gray-600"
                >
                  <Minus size={16} />
                </button>
                <input
                  type="number"
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                  className="w-16 text-center py-2 border-x border-gray-300 outline-none text-sm font-medium"
                  min={1}
                  max={200}
                />
                <button
                  onClick={() => setCopies((c) => Math.min(200, c + 1))}
                  className="px-3 py-2 hover:bg-gray-50 transition-colors text-gray-600"
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="flex gap-1.5">
                {COPY_PRESETS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setCopies(n)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                      copies === n
                        ? 'bg-gray-800 text-white border-gray-800'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t bg-gray-50 flex items-center justify-between flex-shrink-0">
          <p className="text-sm text-gray-500">
            In <span className="font-semibold text-gray-800">{copies}</span> tem · {size.label}
            {activeNccName && (
              <span className="text-indigo-600"> · {activeNccName}</span>
            )}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 transition-colors">
              Đóng
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <Printer size={16} />
              In {copies} Tem
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PrintBatchLabelModal({ items, onClose }: { items: BatchPrintItem[] | null; onClose: () => void }) {
  const [copies, setCopies] = useState<Record<string, number>>(() =>
    items ? Object.fromEntries(items.map(i => [i.product.id, 0])) : {}
  )

  if (!items) return null

  const size = LABEL_SIZES[0]

  function handlePrint() {
    const printItems = items!
      .map(item => {
        const ncc = item.product.product_suppliers?.find(ps => ps.supplier_id === item.supplierId)
                 ?? item.product.product_suppliers?.[0]
        const barcode = ncc?.barcode ?? item.product.barcode ?? ''
        return { product: item.product, barcode, copies: copies[item.product.id] ?? 1 }
      })
      .filter(i => i.copies > 0 && i.barcode)

    if (printItems.length === 0) {
      alert('Không có tem nào để in')
      return
    }

    const win = window.open('', '_blank', 'width=800,height=600,menubar=no,toolbar=no')
    if (!win) {
      alert('Trình duyệt chặn popup. Vui lòng cho phép popup từ trang này.')
      return
    }
    win.document.write(buildBatchPrintHTML(printItems, size))
    win.document.close()
  }

  const totalCopies = Object.values(copies).reduce((s, c) => s + c, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg rounded-t-2xl sm:rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Printer size={17} className="text-blue-600" />
            In Tem Tất Cả Sản Phẩm
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide">Sản Phẩm</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide w-20">SL Nhập</th>
                <th className="text-center px-4 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide w-28">Số Tem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => {
                const ncc = item.product.product_suppliers?.find(ps => ps.supplier_id === item.supplierId)
                         ?? item.product.product_suppliers?.[0]
                return (
                  <tr key={item.product.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{item.product.name}</p>
                      {ncc?.supplier?.name && (
                        <p className="text-xs text-indigo-600 mt-0.5 flex items-center gap-1">
                          <Truck size={10} /> {ncc.supplier.name}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 font-medium">{item.quantity}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        max={200}
                        value={copies[item.product.id] ?? 0}
                        onChange={e => setCopies(prev => ({
                          ...prev,
                          [item.product.id]: Math.max(0, Math.min(200, parseInt(e.target.value) || 0))
                        }))}
                        className="w-full text-center px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-4 border-t bg-gray-50 flex items-center justify-between flex-shrink-0">
          <p className="text-sm text-gray-500">
            Tổng: <span className="font-semibold text-gray-800">{totalCopies}</span> tem ·{' '}
            <span className="text-gray-600">{items.length} sản phẩm</span>
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100 transition-colors">
              Đóng
            </button>
            <button
              onClick={handlePrint}
              disabled={totalCopies === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <Printer size={15} />
              In {totalCopies} Tem
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewBarcode({ barcode, height }: { barcode: string; height: number }) {
  const svgRef = (el: SVGSVGElement | null) => {
    if (!el) return
    try {
      JsBarcode(el, barcode, {
        format: 'CODE128',
        width: 1,
        height,
        displayValue: true,
        fontSize: 7,
        margin: 1,
        background: 'transparent',
        lineColor: '#000',
      })
    } catch { /* ignore invalid barcode */ }
  }
  return <svg ref={svgRef} style={{ maxWidth: '100%' }} />
}

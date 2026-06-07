import type { Product, Category } from '@/types'

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = []
  let inQuotes = false
  let current = ''

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function detectSeparator(firstLine: string): string {
  const semicolons = (firstLine.match(/;/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  return semicolons >= commas ? ';' : ','
}

export function parseCSV(text: string): Record<string, string>[] {
  // strip BOM and sep= hint line
  const clean = text.replace(/^﻿/, '').replace(/^sep=.*\n/i, '')
  const lines = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
  if (lines.length < 2) return []
  const sep = detectSeparator(lines[0])
  const headers = parseCSVLine(lines[0], sep)
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const values = parseCSVLine(l, sep)
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h.trim()] = (values[i] ?? '').trim() })
      return obj
    })
}

// ── CSV row → product insert payload ─────────────────────────────────────────

export interface ImportRow {
  product_code: string
  barcode: string
  name: string
  category_name: string
  sale_price: number
  supplier_name: string
  cost_price: number
  quantity: number
  supplier_note: string
  unit: string
  description: string
}

// Maps flexible Vietnamese / English column names to ImportRow fields
const COL_MAP: Record<string, keyof ImportRow> = {
  'mã hàng': 'product_code', 'ma hang': 'product_code', 'product_code': 'product_code',
  'mã vạch': 'barcode', 'ma vach': 'barcode', 'barcode': 'barcode',
  'tên hàng': 'name', 'ten hang': 'name', 'tên sản phẩm': 'name', 'name': 'name',
  'danh mục': 'category_name', 'danh muc': 'category_name', 'nhóm hàng': 'category_name', 'category': 'category_name',
  'giá bán': 'sale_price', 'gia ban': 'sale_price', 'sale_price': 'sale_price',
  'nhà cung cấp': 'supplier_name', 'nha cung cap': 'supplier_name', 'supplier': 'supplier_name', 'ncc': 'supplier_name',
  'giá vốn': 'cost_price', 'gia von': 'cost_price', 'cost_price': 'cost_price', 'giá vốn (ncc)': 'cost_price',
  'tồn kho': 'quantity', 'ton kho': 'quantity', 'quantity': 'quantity', 'số lượng': 'quantity', 'tồn kho (ncc)': 'quantity',
  'ghi chú ncc': 'supplier_note', 'ghi chu ncc': 'supplier_note', 'supplier_note': 'supplier_note',
  'đơn vị': 'unit', 'don vi': 'unit', 'unit': 'unit',
  'mô tả': 'description', 'mo ta': 'description', 'description': 'description',
}

// Strip Excel text-formula wrapper: ="value" → value
function stripExcelText(v: string): string {
  return v.replace(/^="(.*)"$/, '$1')
}

export function mapCSVRow(row: Record<string, string>): ImportRow | null {
  const mapped: Partial<ImportRow> = {}
  for (const [header, value] of Object.entries(row)) {
    const field = COL_MAP[header.toLowerCase()]
    if (!field) continue
    const clean = stripExcelText(value)
    if (field === 'sale_price' || field === 'cost_price' || field === 'quantity') {
      mapped[field] = parseFloat(clean.replace(/[^0-9.-]/g, '')) || 0
    } else {
      mapped[field] = clean as never
    }
  }
  if (!mapped.name) return null
  return {
    product_code: mapped.product_code ?? '',
    barcode: mapped.barcode ?? '',
    name: mapped.name,
    category_name: mapped.category_name ?? '',
    sale_price: mapped.sale_price ?? 0,
    supplier_name: mapped.supplier_name ?? '',
    cost_price: mapped.cost_price ?? 0,
    quantity: mapped.quantity ?? 0,
    supplier_note: mapped.supplier_note ?? '',
    unit: mapped.unit ?? 'cái',
    description: mapped.description ?? '',
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

// Wrap value in quotes for CSV; use ="value" to force Excel to treat as text (prevents scientific notation on barcodes)
function cell(value: string | number, forceText = false): string {
  const s = String(value).replace(/"/g, '""')
  return forceText ? `="${s}"` : `"${s}"`
}

export function exportProductsCSV(products: Product[], categories: Category[]) {
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]))

  const headers = [
    'Mã hàng', 'Mã vạch', 'Tên hàng', 'Danh mục',
    'Giá bán', 'Nhà cung cấp', 'Giá vốn', 'Tồn kho', 'Ghi chú NCC', 'Đơn vị', 'Mô tả',
  ]

  const buildRow = (
    productCode: string, barcode: string, name: string, catName: string,
    salePrice: number, supplierName: string, costPrice: number,
    qty: number, supplierNote: string, unit: string, description: string,
  ) => [
    cell(productCode, true),   // forceText: mã hàng không bị số hoá
    cell(barcode, true),       // forceText: barcode 13 số không bị scientific notation
    cell(name),
    cell(catName),
    cell(salePrice),
    cell(supplierName),
    cell(costPrice),
    cell(qty),
    cell(supplierNote),
    cell(unit),
    cell(description),
  ].join(';')

  const lines: string[] = [headers.map((h) => cell(h)).join(';')]

  for (const p of products) {
    const catName = catMap[p.category_id] ?? ''
    if (p.product_suppliers && p.product_suppliers.length > 0) {
      for (const ps of p.product_suppliers) {
        lines.push(buildRow(
          p.product_code, ps.barcode || p.barcode, p.name, catName,
          p.sale_price, ps.supplier?.name ?? '', ps.cost_price,
          ps.quantity, ps.note ?? '', p.unit, p.description ?? '',
        ))
      }
    } else {
      lines.push(buildRow(
        p.product_code, p.barcode, p.name, catName,
        p.sale_price, '', p.cost_price, p.quantity, '', p.unit, p.description ?? '',
      ))
    }
  }

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hang-hoa-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Template CSV for users to download before importing
export function downloadImportTemplate() {
  const headers = ['Mã hàng', 'Mã vạch', 'Tên hàng', 'Danh mục', 'Giá bán', 'Nhà cung cấp', 'Giá vốn', 'Tồn kho', 'Ghi chú NCC', 'Đơn vị', 'Mô tả']
  const sample1 = ['1001', '8931234567890', 'Tên sản phẩm mẫu', 'Điện Tử', '100000', 'NCC A', '80000', '30', '', 'cái', 'Mô tả sản phẩm']
  const sample2 = ['1001', '8931234567891', 'Tên sản phẩm mẫu', 'Điện Tử', '100000', 'NCC B', '75000', '20', 'Hàng nhập tháng 6', 'cái', '']
  const toRow = (r: string[], textCols: number[]) =>
    r.map((c, i) => textCols.includes(i) ? `="${c}"` : `"${c}"`).join(';')
  const csv = [
    headers.map((h) => `"${h}"`).join(';'),
    toRow(sample1, [0, 1]),
    toRow(sample2, [0, 1]),
  ].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mau-nhap-hang-hoa.csv'
  a.click()
  URL.revokeObjectURL(url)
}

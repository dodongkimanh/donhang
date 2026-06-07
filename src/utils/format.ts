export function fmtThousands(val: string): string {
  const n = val.replace(/\D/g, '')
  if (!n) return ''
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(amount)
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  const d = new Date(dateString)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function formatDateOnly(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  const d = new Date(dateString)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

export function generateBarcode(): string {
  const prefix = '893'
  const randomPart = Math.floor(Math.random() * 10000000000).toString().padStart(10, '0')
  return prefix + randomPart
}

export function generateProductCode(existingCodes: string[] = []): string {
  let code: string
  let attempts = 0
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString()
    attempts++
  } while (existingCodes.includes(code) && attempts < 200)
  return code
}

export function generateOrderNumber(): string {
  const now = new Date()
  const year = now.getFullYear().toString().slice(-2)
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `DH${year}${month}${day}${rand}`
}

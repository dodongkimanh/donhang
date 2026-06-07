import { supabase, isDemoMode } from '@/lib/supabase'

export const MAX_IMAGE_SIZE_MB = 5
const MAX_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Chỉ chấp nhận file ảnh (jpg, png, webp...)'
  if (file.size > MAX_BYTES) return `Ảnh tối đa ${MAX_IMAGE_SIZE_MB}MB`
  return null
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function uploadImage(
  file: File,
  bucket: string,
  folder: string,
): Promise<string> {
  if (isDemoMode) {
    return toDataUrl(file)
  }

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${folder}/${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type,
  })
  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

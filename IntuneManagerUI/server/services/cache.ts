import prisma from '../db'

export async function getCached(key: string): Promise<Record<string, unknown> | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } })
    if (!row?.value) return null
    return JSON.parse(row.value) as Record<string, unknown>
  } catch { return null }
}

export async function saveCache(key: string, data: Record<string, unknown>): Promise<void> {
  try {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value: JSON.stringify(data) },
      create: { key, value: JSON.stringify(data) }
    })
  } catch { /* non-fatal */ }
}

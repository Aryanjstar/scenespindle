export function characterJson(item: { _id: unknown; name: string; description?: string; style: string; version?: number; state?: string; rights?: string; sheetAssetId?: unknown; referenceAssetId?: unknown; updatedAt?: Date }) {
  return {
    id: String(item._id), name: item.name, description: item.description ?? "", style: item.style, version: item.version ?? 0, state: item.state ?? "draft", rights: item.rights ?? "own",
    sheetUrl: item.sheetAssetId ? `/api/assets/${String(item.sheetAssetId)}/file` : null,
    referenceUrl: item.referenceAssetId ? `/api/assets/${String(item.referenceAssetId)}/file` : null,
    updatedAt: item.updatedAt,
  };
}

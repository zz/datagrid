export interface ResultPagination {
    page: number
    pageSize: number
    pageCount: number
    offset: number
}

export function resultPagination(totalRows: number | null, requestedPage: number, requestedPageSize: number): ResultPagination {
    const pageSize = Math.max(1, Math.floor(requestedPageSize) || 1)
    const pageCount = totalRows == null ? Math.max(1, requestedPage + 1) : Math.max(1, Math.ceil(Math.max(0, totalRows) / pageSize))
    const page = Math.max(0, Math.min(pageCount - 1, Math.floor(requestedPage) || 0))
    return { page, pageSize, pageCount, offset: page * pageSize }
}

export function resultPageRange(page: number, pageSize: number, loadedRows: number): { start: number; end: number } | null {
    if (loadedRows < 1) return null
    const start = page * pageSize + 1
    return { start, end: start + loadedRows - 1 }
}

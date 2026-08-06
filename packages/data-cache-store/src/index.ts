/**
 * @StratCraft/data-cache-store -- Electron-free data-cache read core.
 *
 * TICKET_1276 P2 Batch C1: the `data_cache_files` / `imported_packages` reads
 * behind the three storage-owned data-management MCP tools, shared verbatim
 * between Electron main (DataCacheManager) and the MCP standalone server.
 */

export {
  listCacheFiles,
  getCacheStats,
  listImportedPackages,
  listImportedPackageSummaries,
  buildImportedPackageCoverageReport,
  coverageReportToCsv,
  type SqliteDatabase,
  type SqliteStatement,
  type StatSizeFn,
  type CacheFileRecord,
  type CacheStats,
  type ImportedPackageRecord,
  type ImportedPackageSummary,
  type PackageCoverageEntry,
  type PackageCoverageReport,
  type ListCacheFilesFilters,
} from './data-cache-store';

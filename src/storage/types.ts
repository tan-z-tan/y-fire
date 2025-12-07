/**
 * Storage provider interface for Y.js state persistence.
 * Implementations can use Firestore, GCS, or hybrid storage.
 */
export interface StorageProvider {
  /**
   * Save Y.js state to storage
   * @param data The Y.js encoded state as Uint8Array
   * @returns Promise that resolves when save is complete
   */
  save(data: Uint8Array): Promise<void>;

  /**
   * Load Y.js state from storage
   * @returns Promise that resolves with the Y.js encoded state, or null if not found
   */
  load(): Promise<Uint8Array | null>;

  /**
   * Subscribe to storage changes (for real-time updates)
   * @param callback Function called when data changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (data: Uint8Array | null) => void): () => void;

  /**
   * Clean up resources
   */
  destroy(): void;
}

/**
 * Storage type options
 */
export type StorageType = "firestore" | "gcs" | "hybrid";

/**
 * Configuration for storage providers
 */
export interface StorageConfig {
  /**
   * Storage type to use
   * - "firestore": Store Y.js state in Firestore (default, good for small docs)
   * - "gcs": Store Y.js state in Google Cloud Storage via Firebase Storage
   * - "hybrid": Auto-select based on data size (Firestore for small, GCS for large)
   */
  type: StorageType;

  /**
   * For hybrid storage: threshold in bytes above which GCS is used
   * Default: 900KB (Firestore document limit is 1MB)
   */
  hybridThreshold?: number;

  /**
   * Custom GCS bucket path prefix (for gcs and hybrid types)
   * The full path will be: {gcsPath}/{documentPath}
   */
  gcsPath?: string;
}

/**
 * Default configuration values
 */
export const DEFAULT_STORAGE_CONFIG: Required<StorageConfig> = {
  type: "firestore",
  hybridThreshold: 900 * 1024, // 900KB
  gcsPath: "yjs-documents",
};

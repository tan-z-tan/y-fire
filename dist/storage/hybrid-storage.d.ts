import { FirebaseApp } from "@firebase/app";
import { Bytes } from "@firebase/firestore";
import { StorageProvider } from "./types";
export interface HybridStorageOptions {
    firebaseApp: FirebaseApp;
    documentPath: string;
    docMapper?: (bytes: Bytes) => object;
    hybridThreshold?: number;
    gcsPath?: string;
}
/**
 * Hybrid storage provider for Y.js state.
 * Automatically selects between Firestore and GCS based on data size.
 * - Small documents: stored directly in Firestore (fast, real-time)
 * - Large documents: stored in GCS with metadata in Firestore
 */
export declare class HybridStorage implements StorageProvider {
    private db;
    private storage;
    private documentPath;
    private docMapper;
    private threshold;
    private gcsPath;
    private unsubscribe?;
    private currentStorageType;
    constructor(options: HybridStorageOptions);
    private getStoragePath;
    save(data: Uint8Array): Promise<void>;
    load(): Promise<Uint8Array | null>;
    private loadFromGcs;
    subscribe(callback: (data: Uint8Array | null) => void): () => void;
    destroy(): void;
    /**
     * Get the current storage type being used
     */
    getCurrentStorageType(): "firestore" | "gcs";
}
//# sourceMappingURL=hybrid-storage.d.ts.map
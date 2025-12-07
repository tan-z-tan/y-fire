import { FirebaseApp } from "@firebase/app";
import { StorageProvider } from "./types";
export interface GcsStorageOptions {
    firebaseApp: FirebaseApp;
    documentPath: string;
    gcsPath?: string;
}
/**
 * GCS storage provider for Y.js state using Firebase Storage.
 * Stores the Y.js document state in Google Cloud Storage (via Firebase Storage).
 * Uses Firestore to store metadata and trigger real-time updates.
 */
export declare class GcsStorage implements StorageProvider {
    private storage;
    private db;
    private documentPath;
    private gcsPath;
    private unsubscribe?;
    constructor(options: GcsStorageOptions);
    private getStoragePath;
    save(data: Uint8Array): Promise<void>;
    load(): Promise<Uint8Array | null>;
    subscribe(callback: (data: Uint8Array | null) => void): () => void;
    destroy(): void;
}
//# sourceMappingURL=gcs-storage.d.ts.map
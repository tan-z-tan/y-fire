import { FirebaseApp } from "@firebase/app";
import { Bytes } from "@firebase/firestore";
import { StorageProvider } from "./types";
export interface FirestoreStorageOptions {
    firebaseApp: FirebaseApp;
    documentPath: string;
    docMapper?: (bytes: Bytes) => object;
}
/**
 * Firestore storage provider for Y.js state.
 * Stores the Y.js document state directly in Firestore.
 */
export declare class FirestoreStorage implements StorageProvider {
    private db;
    private documentPath;
    private docMapper;
    private unsubscribe?;
    constructor(options: FirestoreStorageOptions);
    save(data: Uint8Array): Promise<void>;
    load(): Promise<Uint8Array | null>;
    subscribe(callback: (data: Uint8Array | null) => void): () => void;
    destroy(): void;
}
//# sourceMappingURL=firestore-storage.d.ts.map
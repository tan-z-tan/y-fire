import { FirebaseApp } from "@firebase/app";
import {
  getFirestore,
  Firestore,
  doc,
  setDoc,
  onSnapshot,
  Bytes,
  Unsubscribe,
} from "@firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytes,
  getBytes,
  FirebaseStorage,
} from "@firebase/storage";
import { StorageProvider, DEFAULT_STORAGE_CONFIG } from "./types";

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
export class HybridStorage implements StorageProvider {
  private db: Firestore;
  private storage: FirebaseStorage;
  private documentPath: string;
  private docMapper: (bytes: Bytes) => object;
  private threshold: number;
  private gcsPath: string;
  private unsubscribe?: Unsubscribe;
  private currentStorageType: "firestore" | "gcs" = "firestore";

  constructor(options: HybridStorageOptions) {
    this.db = getFirestore(options.firebaseApp);
    this.storage = getStorage(options.firebaseApp);
    this.documentPath = options.documentPath;
    this.docMapper = options.docMapper || ((bytes) => ({ content: bytes }));
    this.threshold =
      options.hybridThreshold || DEFAULT_STORAGE_CONFIG.hybridThreshold;
    this.gcsPath = options.gcsPath || DEFAULT_STORAGE_CONFIG.gcsPath;
  }

  private getStoragePath(): string {
    return `${this.gcsPath}/${this.documentPath}.yjs`;
  }

  async save(data: Uint8Array): Promise<void> {
    const docRef = doc(this.db, this.documentPath);

    if (data.byteLength >= this.threshold) {
      // Large document: store in GCS
      const storageRef = ref(this.storage, this.getStoragePath());
      await uploadBytes(storageRef, data, {
        contentType: "application/octet-stream",
      });

      // Update Firestore with GCS metadata
      await setDoc(
        docRef,
        {
          ...this.docMapper(Bytes.fromUint8Array(new Uint8Array(0))), // Clear content
          content: null, // Explicitly set to null
          gcsPath: this.getStoragePath(),
          storageType: "gcs",
          gcsUpdatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      this.currentStorageType = "gcs";
    } else {
      // Small document: store in Firestore
      await setDoc(
        docRef,
        {
          ...this.docMapper(Bytes.fromUint8Array(data)),
          gcsPath: null, // Clear GCS reference
          storageType: "firestore",
        },
        { merge: true }
      );
      this.currentStorageType = "firestore";
    }
  }

  async load(): Promise<Uint8Array | null> {
    // Load is handled via subscribe for real-time updates
    return null;
  }

  private async loadFromGcs(): Promise<Uint8Array | null> {
    try {
      const storageRef = ref(this.storage, this.getStoragePath());
      const data = await getBytes(storageRef);
      return new Uint8Array(data);
    } catch (error: any) {
      if (error.code === "storage/object-not-found") {
        return null;
      }
      throw error;
    }
  }

  subscribe(callback: (data: Uint8Array | null) => void): () => void {
    let lastGcsUpdatedAt: string | null = null;

    this.unsubscribe = onSnapshot(
      doc(this.db, this.documentPath),
      async (docSnapshot) => {
        if (docSnapshot.exists()) {
          const docData = docSnapshot.data();
          if (docData) {
            if (docData.storageType === "gcs" && docData.gcsPath) {
              // Data is in GCS - check if it's been updated
              const gcsUpdatedAt = docData.gcsUpdatedAt;
              if (gcsUpdatedAt !== lastGcsUpdatedAt) {
                lastGcsUpdatedAt = gcsUpdatedAt;
                try {
                  const data = await this.loadFromGcs();
                  if (data) {
                    callback(data);
                  }
                } catch (error) {
                  console.error(
                    "HybridStorage: failed to load from GCS",
                    error
                  );
                }
              }
            } else if (docData.content) {
              // Data is in Firestore
              lastGcsUpdatedAt = null;
              const content = docData.content.toUint8Array();
              callback(content);
            }
          }
        }
      },
      (error) => {
        console.error("HybridStorage: snapshot error", error);
      }
    );

    return () => {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = undefined;
      }
    };
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Get the current storage type being used
   */
  getCurrentStorageType(): "firestore" | "gcs" {
    return this.currentStorageType;
  }
}

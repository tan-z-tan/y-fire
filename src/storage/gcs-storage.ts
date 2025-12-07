import { FirebaseApp } from "@firebase/app";
import {
  getStorage,
  ref,
  uploadBytes,
  getBytes,
  FirebaseStorage,
} from "@firebase/storage";
import {
  getFirestore,
  Firestore,
  doc,
  setDoc,
  onSnapshot,
  Unsubscribe,
  serverTimestamp,
} from "@firebase/firestore";
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
export class GcsStorage implements StorageProvider {
  private storage: FirebaseStorage;
  private db: Firestore;
  private documentPath: string;
  private gcsPath: string;
  private unsubscribe?: Unsubscribe;

  constructor(options: GcsStorageOptions) {
    this.storage = getStorage(options.firebaseApp);
    this.db = getFirestore(options.firebaseApp);
    this.documentPath = options.documentPath;
    this.gcsPath = options.gcsPath || "yjs-documents";
  }

  private getStoragePath(): string {
    return `${this.gcsPath}/${this.documentPath}.yjs`;
  }

  async save(data: Uint8Array): Promise<void> {
    // Save to GCS
    const storageRef = ref(this.storage, this.getStoragePath());
    await uploadBytes(storageRef, data, {
      contentType: "application/octet-stream",
    });

    // Update Firestore metadata to trigger real-time updates
    const docRef = doc(this.db, this.documentPath);
    await setDoc(
      docRef,
      {
        gcsPath: this.getStoragePath(),
        gcsUpdatedAt: serverTimestamp(),
        storageType: "gcs",
      },
      { merge: true }
    );
  }

  async load(): Promise<Uint8Array | null> {
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
    // Watch Firestore metadata for changes, then load from GCS
    this.unsubscribe = onSnapshot(
      doc(this.db, this.documentPath),
      async (docSnapshot) => {
        if (docSnapshot.exists()) {
          const docData = docSnapshot.data();
          if (docData && docData.gcsPath) {
            try {
              const data = await this.load();
              callback(data);
            } catch (error) {
              console.error("GcsStorage: failed to load from GCS", error);
            }
          }
        }
      },
      (error) => {
        console.error("GcsStorage: snapshot error", error);
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
}

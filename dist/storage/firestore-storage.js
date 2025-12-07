var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getFirestore, doc, setDoc, onSnapshot, Bytes, } from "@firebase/firestore";
/**
 * Firestore storage provider for Y.js state.
 * Stores the Y.js document state directly in Firestore.
 */
export class FirestoreStorage {
    constructor(options) {
        this.db = getFirestore(options.firebaseApp);
        this.documentPath = options.documentPath;
        this.docMapper = options.docMapper || ((bytes) => ({ content: bytes }));
    }
    save(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const ref = doc(this.db, this.documentPath);
            yield setDoc(ref, this.docMapper(Bytes.fromUint8Array(data)), {
                merge: true,
            });
        });
    }
    load() {
        return __awaiter(this, void 0, void 0, function* () {
            // Load is handled via subscribe for real-time updates
            // This method is kept for interface compliance
            return null;
        });
    }
    subscribe(callback) {
        this.unsubscribe = onSnapshot(doc(this.db, this.documentPath), (docSnapshot) => {
            if (docSnapshot.exists()) {
                const docData = docSnapshot.data();
                if (docData && docData.content) {
                    const content = docData.content.toUint8Array();
                    callback(content);
                }
            }
        }, (error) => {
            console.error("FirestoreStorage: snapshot error", error);
        });
        return () => {
            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = undefined;
            }
        };
    }
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = undefined;
        }
    }
}

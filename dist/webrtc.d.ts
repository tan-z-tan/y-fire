/// <reference types="node" />
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { FirebaseApp } from "@firebase/app";
import { Firestore } from "@firebase/firestore";
import { ObservableV2 } from "lib0/observable";
import SimplePeer from "simple-peer-light";
interface Parameters {
    firebaseApp: FirebaseApp;
    ydoc: Y.Doc;
    awareness: awarenessProtocol.Awareness;
    instanceConnection: ObservableV2<any>;
    documentPath: string;
    uid: string;
    peerUid: string;
    isCaller: boolean;
    encodingVersion?: 1 | 2;
    iceServers?: RTCIceServer[];
}
export declare const DEFAULT_ICE_SERVERS: RTCIceServer[];
/** Emitted on instanceConnection as "link-error" when a peer link dies with an error. */
export interface LinkError {
    peerUid: string;
    isCaller: boolean;
    /** simple-peer error code, e.g. ERR_ICE_CONNECTION_FAILURE */
    code: string;
}
export declare class WebRtc extends ObservableV2<any> {
    readonly doc: Y.Doc;
    awareness: awarenessProtocol.Awareness;
    instanceConnection: ObservableV2<any>;
    readonly documentPath: string;
    uid: string;
    peerUid: string;
    peer: SimplePeer.Instance;
    readonly db: Firestore;
    private unsubscribeHandshake?;
    isCaller: boolean;
    ice: {
        iceServers: RTCIceServer[];
    };
    peerKey: CryptoKey;
    connection: string;
    /** Set when the link was closed by an error (simple-peer error code). */
    closeReason?: string;
    clock: string | number | NodeJS.Timeout;
    idleThreshold: number;
    encodingVersion: 1 | 2;
    constructor({ firebaseApp, ydoc, awareness, instanceConnection, documentPath, uid, peerUid, isCaller, encodingVersion, iceServers, }: Parameters);
    initPeer: () => void;
    startInitClock: () => void;
    createKey: () => Promise<void>;
    createPeer: (config: {
        initiator: boolean;
        config: {
            iceServers: RTCIceServer[];
        };
        trickle: boolean;
        channelName?: string;
    }) => void;
    callPeer: () => void;
    replyPeer: () => void;
    handshake: () => void;
    unsubHandshake: () => void;
    connect: (signal: SimplePeer.SignalData) => void;
    deleteSignals: () => void;
    handleOnConnected: () => void;
    handleOnError: (error: {
        code?: string;
        message?: string;
    } | null) => void;
    handleOnClose: () => void;
    sendData: ({ message, data, }: {
        message: unknown;
        data: Uint8Array | null;
    }) => Promise<void>;
    handleReceivingData: (data: any) => Promise<void>;
    consoleHandler: (message: any, data?: any) => void;
    errorHandler: (error: any) => void;
    destroy(): Promise<void>;
}
export {};
//# sourceMappingURL=webrtc.d.ts.map
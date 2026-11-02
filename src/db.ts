import type { Project } from "./types";

const DB_NAME = "site-sketch";
const STORE = "projects";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the sketch database."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Sketch database request failed."));
  });
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const all = await requestToPromise(tx.objectStore(STORE).getAll() as IDBRequest<Project[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function putProject(project: Project): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await requestToPromise(tx.objectStore(STORE).put(project));
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await requestToPromise(tx.objectStore(STORE).delete(id));
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Sketch database transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Sketch database transaction aborted."));
  });
}

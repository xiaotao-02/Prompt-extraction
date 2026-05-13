/**
 * 极简的 IndexedDB 封装，专门为持久化 FileSystemDirectoryHandle 设计。
 *
 * 为什么必须用 IndexedDB 而不是 chrome.storage：
 * - 通过 File System Access API 拿到的 FileSystemDirectoryHandle 是 **不可序列化** 的，
 *   不能直接 JSON.stringify。
 * - IndexedDB 通过结构化克隆算法（structured clone）支持原生持久化这类 handle，
 *   是浏览器官方推荐的存放方式。
 *
 * 局限：
 * - 扩展被用户卸载时，IndexedDB 同样会被清空。所以"重装后自动识别本地数据"必须由
 *   用户**手动再选一次同一个目录**完成；这个目录里的 JSON 文件本身是用户磁盘的普通
 *   文件，不会随扩展卸载消失，所以选回去之后能完整还原。
 */
const DB_NAME = 'prompt-extracto-fs';
const DB_VERSION = 1;
const STORE = 'handles';

const DIR_HANDLE_KEY = 'data-directory';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  cb: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T | undefined;
    Promise.resolve(cb(store))
      .then((r) => {
        if (r && typeof (r as IDBRequest).onsuccess !== 'undefined') {
          const req = r as IDBRequest<T>;
          req.onsuccess = () => {
            result = req.result;
          };
          req.onerror = () => reject(req.error);
        } else {
          result = r as T;
        }
      })
      .catch(reject);
    tx.oncomplete = () => {
      db.close();
      resolve(result as T);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore('readwrite', (store) => store.put(handle, DIR_HANDLE_KEY));
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const result = await withStore<FileSystemDirectoryHandle | undefined>('readonly', (store) =>
      store.get(DIR_HANDLE_KEY)
    );
    return result || null;
  } catch {
    return null;
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(DIR_HANDLE_KEY));
  } catch {
    /* ignore */
  }
}

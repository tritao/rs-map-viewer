export type PacketKeyed = Readonly<{ orderKey?: number }>;

// Applies a stable ordering driven by a packed key list (the packet keys) while preserving
// duplicates by using a queue per key, matching the WebGL renderable ordering logic.
export function orderByPacketKeys<T extends PacketKeyed>(
    items: ReadonlyArray<T>,
    orderKeys: Int32Array | undefined,
): T[] {
    if (!(orderKeys instanceof Int32Array) || orderKeys.length === 0) {
        return items as T[];
    }

    const byKey = new Map<number, T[]>();
    for (const item of items) {
        const key = item.orderKey;
        if (key === undefined) {
            continue;
        }
        const list = byKey.get(key);
        if (list) {
            list.push(item);
        } else {
            byKey.set(key, [item]);
        }
    }

    const ordered: T[] = [];
    for (let i = 0; i < orderKeys.length; i++) {
        const key = orderKeys[i] | 0;
        const list = byKey.get(key);
        if (!list || list.length === 0) {
            continue;
        }
        ordered.push(list.shift()!);
    }

    return ordered.length > 0 ? ordered : (items as T[]);
}


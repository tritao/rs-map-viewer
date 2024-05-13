import { Node } from "../collection/Node";

export class LinkedList {
    public head: Node = new Node();

    public current: Node | null;

    public constructor() {
        this.current = null;
        this.head.next = this.head;
        this.head.previous = this.head;
    }

    public insertBack(node: Node) {
        if (node.previous != null) { node.remove(); }
        node.previous = this.head.previous;
        node.next = this.head;
        if (node.previous != null) {
            node.previous.next = node;
        }
        node.next.previous = node;
    }

    public addFirst(node: Node) {
        if (node.previous != null) { node.remove(); }
        node.previous = this.head;
        node.next = this.head.next;
        node.previous.next = node;
        if (node.next != null) {
            node.next.previous = node;
        }
    }

    public removeFirst(): Node | null {
        const node: Node | null = this.head.next;
        if (node == null || node === this.head) {
            return null;
        } else {
            node.remove();
            return node;
        }
    }

    public first(): Node | null {
        const node: Node | null = this.head.next;
        if (node == null || node === this.head) {
            this.current = null;
            return null;
        } else {
            this.current = node.next;
            return node;
        }
    }

    public last(): Node | null {
        const node: Node | null = this.head.previous;
        if (node == null || node === this.head) {
            this.current = null;
            return null;
        } else {
            this.current = node.previous;
            return node;
        }
    }

    public next(): Node | null {
        const node: Node | null = this.current;
        if (node === null) {
            return null;
        }
        if (node === this.head) {
            this.current = null;
            return null;
        }
        this.current = node.next;
        return node;
    }

    public previous(): Node | null {
        const node: Node | null = this.current;
        if (node === null) {
            return null;
        }
        if (node === this.head) {
            this.current = null;
            return null;
        } else {
            this.current = node.previous;
            return node;
        }
    }

    public clear() {
        if (this.head.next === this.head) { return; }
        do {
            {
                const node: Node | null = this.head.next;
                if (node == null || node === this.head) { return; }
                node.remove();
            }
        } while ((true));
    }
}

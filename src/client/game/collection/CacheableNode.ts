/* Generated from Java with JSweet 2.3.0 - http://www.jsweet.org */
import { Node } from "./Node";

export class CacheableNode extends Node {

    public cacheNext: CacheableNode | null = null;

    public cachePrevious: CacheableNode | null = null;

    public constructor() {
        super();
        this.cacheNext = null;
        this.cachePrevious = null;
    }
    public clear() {
        if (this.cachePrevious == null) {
            return;
        } else {
            this.cachePrevious.next = this.next;
            if (this.cacheNext != null) {
                this.cacheNext.cachePrevious = this.cachePrevious;
                this.cacheNext = null;
            }
            this.cachePrevious = null;
            return;
        }
    }
}

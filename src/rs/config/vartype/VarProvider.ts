import { BIT_MASKS } from "../../MathConstants";
import { VarBitTypeLoader } from "./bit/VarBitTypeLoader";

export interface VarProvider {
    getVarp(id: number): number;
    getVarbit(id: number): number;
}

/**
 * Read-only var access backed by a snapshot `Int32Array`. The snapshot can be replaced wholesale
 * (e.g. when worker threads receive updated var values).
 */
export class VarStateProvider implements VarProvider {
    private values: Int32Array;

    constructor(
        readonly varbitLoader: VarBitTypeLoader,
        values: Int32Array,
    ) {
        this.values = values;
    }

    set(values: Int32Array): void {
        this.values = values;
    }

    getVarp(id: number): number {
        return this.values[id] ?? 0;
    }

    getVarbit(id: number): number {
        const { baseVar, startBit, endBit } = this.varbitLoader.load(id);
        const mask = BIT_MASKS[endBit - startBit];
        const baseValue = this.values[baseVar] ?? 0;
        return (baseValue >> startBit) & mask;
    }
}


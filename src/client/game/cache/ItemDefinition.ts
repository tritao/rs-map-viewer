import { Model } from "../renderable/Model";

export class ItemDefinition {
    equipmentReady(gender: number) {
        throw new Error("Method not implemented.");
    }
    headPieceReady(gender: number): boolean {
        throw new Error("Method not implemented.");
    }

    static lookup(arg0: number): ItemDefinition {
        throw new Error("Method not implemented.");
    }

    asHeadPiece(gender: number): Model {
        throw new Error("Method not implemented.");
    }
}

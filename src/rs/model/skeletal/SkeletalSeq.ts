import { mat4, quat, vec3 } from "gl-matrix";

import { ByteBuffer } from "../../io/ByteBuffer";
import { SeqBase } from "../seq/SeqBase";
import { SeqBaseLoader } from "../seq/SeqBaseLoader";
import { Curve } from "./Curve";
import { getCurveIndex, getCurveTypeForId } from "./CurveType";
import { SkeletalBase } from "./SkeletalBase";
import { SkeletalBone } from "./SkeletalBone";
import type { SkeletalPools } from "./SkeletalPools";
import {
    SkeletalTransformType,
    getCurveCount,
    getTransformTypeForId,
} from "./SkeletalTransformType";

export class SkeletalSeq {
    poseId: number;
    curveCount: number;

    boneCurves: Curve[][];
    curves: Curve[][];

    hasAlphaTransform: boolean = false;

    static tryLoad(baseLoader: SeqBaseLoader, id: number, data: Uint8Array): SkeletalSeq | undefined {
        try {
            const buffer = new ByteBuffer(data);

            const version = buffer.readUnsignedByte();
            const baseId = buffer.readUnsignedShort();
            const base = baseLoader.load(baseId);
            if (!base) {
                return undefined;
            }
            const skeletalBase = base.skeletalBase;
            if (!skeletalBase) {
                return undefined;
            }

            return new SkeletalSeq(id, version, base, skeletalBase, buffer);
        } catch (e) {
            console.error("Failed decoding skeletal seq", id, e);
            return undefined;
        }
    }

    static load(baseLoader: SeqBaseLoader, id: number, data: Uint8Array): SkeletalSeq {
        const decoded = this.tryLoad(baseLoader, id, data);
        if (!decoded) {
            throw new Error("Failed decoding skeletal seq");
        }
        return decoded;
    }

    constructor(
        readonly id: number,
        readonly version: number,
        readonly base: SeqBase,
        readonly skeletalBase: SkeletalBase,
        buffer: ByteBuffer,
    ) {
        buffer.readUnsignedShort();
        buffer.readUnsignedShort();
        this.poseId = buffer.readUnsignedByte();
        this.curveCount = buffer.readUnsignedShort();
        this.boneCurves = new Array(skeletalBase.bones.length);
        this.curves = new Array(base.count);

        for (let i = 0; i < this.curveCount; i++) {
            const transformType = getTransformTypeForId(buffer.readUnsignedByte());

            const boneIndex = buffer.readSmart2();
            const curveType = getCurveTypeForId(buffer.readUnsignedByte());

            const curve = new Curve(i);
            curve.decode(buffer, version);

            let curves: Curve[][];
            if (transformType === SkeletalTransformType.BONE) {
                curves = this.boneCurves;
            } else {
                curves = this.curves;
            }

            if (curves[boneIndex] === undefined) {
                curves[boneIndex] = new Array(getCurveCount(transformType));
            }

            curve.load();
            curves[boneIndex][getCurveIndex(curveType)] = curve;

            if (transformType === SkeletalTransformType.ALPHA) {
                this.hasAlphaTransform = true;
            }
        }
    }

    updateAnimMatrix(
        frame: number,
        bone: SkeletalBone,
        boneIndex: number,
        poseId: number,
        pools: SkeletalPools,
    ): void {
        const matrix = pools.matrices.get();

        this.applyRotation(matrix, boneIndex, bone, frame, pools);
        this.applyScaling(matrix, boneIndex, bone, frame, pools);
        this.applyTranslation(matrix, boneIndex, bone, frame);
        bone.setAnimMatrix(matrix);

        pools.matrices.release(matrix);
    }

    applyRotation(
        matrix: mat4,
        boneIndex: number,
        bone: SkeletalBone,
        frame: number,
        pools: SkeletalPools,
    ): void {
        const rotation = bone.getRotation(this.poseId);
        let rotateX = rotation[0];
        let rotateY = rotation[1];
        let rotateZ = rotation[2];

        if (this.boneCurves[boneIndex]) {
            const curveX = this.boneCurves[boneIndex][0];
            const curveY = this.boneCurves[boneIndex][1];
            const curveZ = this.boneCurves[boneIndex][2];
            if (curveX) {
                rotateX = curveX.getValue(frame);
            }
            if (curveY) {
                rotateY = curveY.getValue(frame);
            }
            if (curveZ) {
                rotateZ = curveZ.getValue(frame);
            }
        }

        const quatX = pools.quats.get();
        vec3.set(pools.rotateAxis, 1, 0, 0);
        quat.setAxisAngle(quatX, pools.rotateAxis, rotateX);
        const quatY = pools.quats.get();
        vec3.set(pools.rotateAxis, 0, 1, 0);
        quat.setAxisAngle(quatY, pools.rotateAxis, rotateY);
        const quatZ = pools.quats.get();
        vec3.set(pools.rotateAxis, 0, 0, 1);
        quat.setAxisAngle(quatZ, pools.rotateAxis, rotateZ);
        const quaternion = pools.quats.get();
        quat.mul(quaternion, quatZ, quaternion);
        quat.mul(quaternion, quatX, quaternion);
        quat.mul(quaternion, quatY, quaternion);

        const rotateMatrix = pools.matrices.get();

        mat4.fromQuat(rotateMatrix, quaternion);
        mat4.mul(matrix, rotateMatrix, matrix);

        pools.quats.release(quatX);
        pools.quats.release(quatY);
        pools.quats.release(quatZ);
        pools.quats.release(quaternion);
        pools.matrices.release(rotateMatrix);
    }

    applyScaling(
        matrix: mat4,
        boneIndex: number,
        bone: SkeletalBone,
        frame: number,
        pools: SkeletalPools,
    ): void {
        const scaling = bone.getScaling(this.poseId);
        let scaleX = scaling[0];
        let scaleY = scaling[1];
        let scaleZ = scaling[2];

        if (this.boneCurves[boneIndex]) {
            const curveX = this.boneCurves[boneIndex][6];
            const curveY = this.boneCurves[boneIndex][7];
            const curveZ = this.boneCurves[boneIndex][8];
            if (curveX) {
                scaleX = curveX.getValue(frame);
            }
            if (curveY) {
                scaleY = curveY.getValue(frame);
            }
            if (curveZ) {
                scaleZ = curveZ.getValue(frame);
            }
        }

        const scaleMatrix = pools.matrices.get();

        vec3.set(pools.scaleVector, scaleX, scaleY, scaleZ);
        mat4.fromScaling(scaleMatrix, pools.scaleVector);
        mat4.mul(matrix, scaleMatrix, matrix);

        pools.matrices.release(scaleMatrix);
    }

    applyTranslation(matrix: mat4, boneIndex: number, bone: SkeletalBone, frame: number): void {
        const translation = bone.getTranslation(this.poseId);
        let transX = translation[0];
        let transY = translation[1];
        let transZ = translation[2];

        if (this.boneCurves[boneIndex]) {
            const curveX = this.boneCurves[boneIndex][3];
            const curveY = this.boneCurves[boneIndex][4];
            const curveZ = this.boneCurves[boneIndex][5];
            if (curveX) {
                transX = curveX.getValue(frame);
            }
            if (curveY) {
                transY = curveY.getValue(frame);
            }
            if (curveZ) {
                transZ = curveZ.getValue(frame);
            }
        }

        matrix[12] = transX;
        matrix[13] = transY;
        matrix[14] = transZ;
    }
}

import { mat4, vec3, vec4 } from "gl-matrix";

import { DEGREES_TO_RADIANS, RS_TO_RADIANS } from "../rs/MathConstants";
import { clamp } from "../util/MathUtil";
import { Frustum } from "./Frustum";

export interface CameraView {
    position: vec3;
    pitch: number;
    yaw: number;
    fov: number;
    orthoZoom: number;
}

export enum ProjectionType {
    PERSPECTIVE,
    ORTHO,
}

export class Ray {
    // Create ray
    static nearScreenPos: vec4 = vec4.create();
    static farScreenPos: vec4 = vec4.create();
    static nearWorldPos: vec4 = vec4.create();
    static farWorldPos: vec4 = vec4.create();

    // Intersects box
    static tMin: vec3 = vec3.create();
    static tMax: vec3 = vec3.create();
    static t1: vec3 = vec3.create();
    static t2: vec3 = vec3.create();

    origin: vec3 = vec3.create();
    destination: vec3 = vec3.create();
    direction: vec3 = vec3.create();

    fromMouseAndProjection(
        mouseX: number,
        mouseY: number,
        width: number,
        height: number,
        invViewProjMatrix: mat4,
    ): Ray {
        const x = (2.0 * mouseX) / width - 1.0;
        const y = 1.0 - (2.0 * mouseY) / height;

        vec4.set(Ray.nearScreenPos, x, y, -1, 1);
        vec4.set(Ray.farScreenPos, x, y, 1, 1);

        vec4.transformMat4(Ray.nearWorldPos, Ray.nearScreenPos, invViewProjMatrix);
        vec4.transformMat4(Ray.farWorldPos, Ray.farScreenPos, invViewProjMatrix);

        vec4.scale(Ray.nearWorldPos, Ray.nearWorldPos, 1 / Ray.nearWorldPos[3]);
        vec4.scale(Ray.farWorldPos, Ray.farWorldPos, 1 / Ray.farWorldPos[3]);

        vec3.set(this.origin, Ray.nearWorldPos[0], Ray.nearWorldPos[1], Ray.nearWorldPos[2]);
        vec3.set(this.destination, Ray.farWorldPos[0], Ray.farWorldPos[1], Ray.farWorldPos[2]);
        vec3.sub(this.direction, this.destination, this.origin);
        vec3.normalize(this.direction, this.direction);

        return this;
    }

    intersectsBox(min: vec3, max: vec3): boolean {
        vec3.divide(Ray.tMin, vec3.sub(Ray.tMin, min, this.origin), this.direction);
        vec3.divide(Ray.tMax, vec3.sub(Ray.tMax, max, this.origin), this.direction);
        vec3.min(Ray.t1, Ray.tMin, Ray.tMax);
        vec3.max(Ray.t2, Ray.tMin, Ray.tMax);
        const tNear = Math.max(Ray.t1[0], Ray.t1[1], Ray.t1[2]);
        const tFar = Math.min(Ray.t2[0], Ray.t2[1], Ray.t2[2]);
        return tFar >= tNear && tFar >= 0;
    }
}

export class Camera {
    static moveCameraRotOrigin: vec3 = vec3.create();
    static temp: vec3 = vec3.create();

    pos: vec3;

    pitch: number;
    yaw: number;

    projectionType: ProjectionType = ProjectionType.PERSPECTIVE;

    fov: number = 90;
    orthoZoom: number = 15;

    projectionMatrix: mat4 = mat4.create();
    cameraMatrix: mat4 = mat4.create();
    viewMatrix: mat4 = mat4.create();
    viewProjMatrix: mat4 = mat4.create();
    invViewProjMatrix: mat4 = mat4.create();

    frustum = new Frustum();

    updated: boolean = false;
    updatedPosition: boolean = false;
    updatedLastFrame: boolean = false;

    constructor(x: number, y: number, z: number, pitch: number, yaw: number) {
        this.pos = vec3.fromValues(x, y, z);
        this.pitch = pitch;
        this.yaw = yaw;
    }

    setProjectionType(type: ProjectionType) {
        this.projectionType = type;
        this.updated = true;
    }

    move(deltaX: number, deltaY: number, deltaZ: number, rotatePitch: boolean = false): void {
        Camera.temp[0] = deltaX;
        Camera.temp[1] = deltaY;
        Camera.temp[2] = deltaZ;

        if (rotatePitch) {
            vec3.rotateX(
                Camera.temp,
                Camera.temp,
                Camera.moveCameraRotOrigin,
                -this.pitch * RS_TO_RADIANS,
            );
        }
        vec3.rotateY(
            Camera.temp,
            Camera.temp,
            Camera.moveCameraRotOrigin,
            (this.yaw - 1024) * RS_TO_RADIANS,
        );

        vec3.add(this.pos, this.pos, Camera.temp);
        this.updated = true;
        this.updatedPosition = true;
    }

    updatePitch(pitch: number, deltaPitch: number): void {
        const maxPitch = this.projectionType === ProjectionType.PERSPECTIVE ? 512 : 0;
        this.pitch = clamp(pitch + deltaPitch, -512, maxPitch);
        this.updated = true;
    }

    getYaw(): number {
        return this.yaw & 2047;
    }

    setYaw(yaw: number): void {
        this.yaw = yaw;
        this.updated = true;
    }

    updateYaw(yaw: number, deltaYaw: number): void {
        this.setYaw(yaw + deltaYaw);
    }

    update(width: number, height: number) {
        // Projection
        mat4.identity(this.projectionMatrix);
        if (this.projectionType === ProjectionType.PERSPECTIVE) {
            const aspect = width / height;
            const near = 0.1;
            const far = 1024.0 * 4;
            const top = Math.tan(this.fov * DEGREES_TO_RADIANS * 0.5) * near;
            const bottom = -top;
            const left = aspect * bottom;
            const right = aspect * top;
            mat4.frustum(this.projectionMatrix, left, right, bottom, top, near, far);
        } else {
            mat4.ortho(
                this.projectionMatrix,
                -width / this.orthoZoom,
                width / this.orthoZoom,
                -height / this.orthoZoom,
                height / this.orthoZoom,
                -1024.0 * 4,
                1024.0 * 4,
            );
        }
        // const temp = mat4.create();
        // this.pickProjectionMatrix(temp, 50, 50, 100, 100, width, height);
        // this.projectionMatrix = temp;

        // View
        const pitch = this.pitch * RS_TO_RADIANS;
        const yaw = (this.yaw - 1024) * RS_TO_RADIANS;

        mat4.identity(this.cameraMatrix);

        mat4.translate(this.cameraMatrix, this.cameraMatrix, this.pos);
        mat4.rotateY(this.cameraMatrix, this.cameraMatrix, yaw);
        mat4.rotateZ(this.cameraMatrix, this.cameraMatrix, 180 * DEGREES_TO_RADIANS); // Roll
        mat4.rotateX(this.cameraMatrix, this.cameraMatrix, pitch);

        mat4.invert(this.viewMatrix, this.cameraMatrix);

        // Calculate view projection matrix
        mat4.multiply(this.viewProjMatrix, this.projectionMatrix, this.viewMatrix);

        mat4.invert(this.invViewProjMatrix, this.viewProjMatrix);

        this.frustum.setPlanes(this.viewProjMatrix);
    }

    pickMatrix(
        out: mat4,
        x: number,
        y: number,
        width: number,
        height: number,
        viewportX: number,
        viewportY: number,
        viewportWidth: number,
        viewportHeight: number,
    ): mat4 {
        const centerX = x - viewportX;
        const centerY = y - viewportY;

        const scaleX = viewportWidth / width;
        const scaleY = viewportHeight / height;
        const translateX = (viewportWidth - 2 * centerX) / width;
        const translateY = (viewportHeight - 2 * centerY) / height;

        mat4.identity(out);
        vec3.set(Camera.temp, translateX, translateY, 0);
        mat4.translate(out, out, Camera.temp);
        vec3.set(Camera.temp, scaleX, scaleY, 1);
        mat4.scale(out, out, Camera.temp);

        return out;
    }

    pickProjectionMatrix(
        out: mat4,
        mouseX: number,
        mouseY: number,
        pickWidth: number,
        pickHeight: number,
        viewportWidth: number,
        viewportHeight: number,
    ): mat4 {
        mat4.identity(out);

        this.pickMatrix(
            out,
            mouseX,
            mouseY,
            pickWidth,
            pickHeight,
            0,
            0,
            viewportWidth,
            viewportHeight,
        );

        // Multiply pick matrix with projection matrix
        mat4.multiply(out, out, this.projectionMatrix);

        return out;
    }

    pickViewProjectionMatrix(
        out: mat4,
        mouseX: number,
        mouseY: number,
        pickWidth: number,
        pickHeight: number,
        viewportWidth: number,
        viewportHeight: number,
    ): mat4 {
        mat4.identity(out);

        this.pickProjectionMatrix(
            out,
            mouseX,
            mouseY,
            pickWidth,
            pickHeight,
            viewportWidth,
            viewportHeight,
        );

        // Multiply pick matrix with view projection matrix
        mat4.multiply(out, out, this.viewMatrix);

        return out;
    }

    onFrameEnd() {
        this.updatedLastFrame = this.updated;
        this.updated = false;
        this.updatedPosition = false;
    }

    getPosX(): number {
        return this.pos[0];
    }

    getPosY(): number {
        return this.pos[1];
    }

    getPosZ(): number {
        return this.pos[2];
    }

    getMapX(): number {
        return this.getPosX() >> 6;
    }

    getMapY(): number {
        return this.getPosZ() >> 6;
    }
}